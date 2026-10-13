"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileStack, Layers, Printer, Trash2 } from "lucide-react";
import { api, ClientApiError, uploadWithProgress } from "@/lib/client/api";
import { DUPLICATE_LABELS, type DuplicateType } from "@/lib/duplicates";
import { formatNumber, plural } from "@/lib/format";
import { groupByMarketplace, sortLabels } from "@/lib/labels";
import { normalizeSettings, SORT_MODES, type OutputSettings, type SortMode } from "@/lib/output-settings";
import { LIMITS } from "@/lib/plans";
import { JobSummary } from "../job-result";
import { Alert, Badge, Button, Card, cx, EmptyState, Modal, Select, Spinner, useToast } from "../ui";
import { Dropzone } from "./dropzone";
import { FilesTable } from "./files-table";
import { LabelGrid } from "./label-grid";
import { SettingsPanel } from "./settings-panel";
import type { BatchDetail, LabelDto, UploadItem } from "./types";

const UPLOAD_CONCURRENCY = 3;
/** Etiquetas exibidas por vez na grade (lotes podem ter milhares). */
const PAGE_SIZE = 100;
type Filter = "ALL" | "DUPLICATES" | "EXCLUDED";

function estimatePages(labels: LabelDto[], s: OutputSettings) {
  const included = labels.filter((l) => !l.excluded);
  const per = s.format === "A4" ? s.perSheet : 1;
  if (!s.groupByMarketplace || !s.separatorPages) return Math.ceil(included.length / per);
  return groupByMarketplace(included).reduce((acc, g) => acc + 1 + Math.ceil(g.items.length / per), 0);
}

function Step({ n, title, done, active }: { n: number; title: string; done: boolean; active: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cx(
          "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
          done ? "bg-ok text-white" : active ? "bg-action text-white" : "bg-line text-ink-soft",
        )}
      >
        {done ? <CheckCircle2 className="size-4" aria-hidden /> : n}
      </span>
      <span className={cx("text-sm", active ? "font-medium text-ink" : "text-ink-soft")}>{title}</span>
    </li>
  );
}

export function Workspace({
  initialBatchId,
  emptyExtra,
}: {
  initialBatchId: string | null;
  emptyExtra?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [batchId, setBatchId] = useState<string | null>(initialBatchId);
  const [data, setData] = useState<BatchDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busyFiles, setBusyFiles] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("ALL");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [settings, setSettings] = useState<OutputSettings | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmDup, setConfirmDup] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const mutating = useRef(0);
  const dataRef = useRef<BatchDetail | null>(null);
  const uploadsRef = useRef<UploadItem[]>([]);
  dataRef.current = data;
  uploadsRef.current = uploads;
  const batchIdRef = useRef<string | null>(initialBatchId);
  const creating = useRef<Promise<string> | null>(null);
  const queue = useRef<UploadItem[]>([]);
  const active = useRef(0);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------ carga
  const load = useCallback(async (id: string, force = false) => {
    try {
      const d = await api<BatchDetail>(`/api/batches/${id}`);
      if (force || mutating.current === 0) {
        setData(d);
        setSettings((prev) => prev ?? d.batch.settings);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (initialBatchId) load(initialBatchId, true);
  }, [initialBatchId, load]);

  const files = data?.files ?? [];
  const labels = useMemo(() => data?.labels ?? [], [data]);
  const job = data?.job ?? null;
  const jobRunning = job?.status === "QUEUED" || job?.status === "PROCESSING";
  const analyzing = files.some((f) => f.status === "PENDING" || f.status === "ANALYZING");
  const uploading = uploads.some((u) => u.status !== "error");
  const locked = data?.batch.status === "GENERATING" || jobRunning;

  // Atualização automática enquanto há análise ou geração em andamento.
  useEffect(() => {
    if (!batchId || !(analyzing || jobRunning || uploading || data?.batch.status === "GENERATING")) return;
    // Lotes grandes trazem milhares de etiquetas por consulta: atualiza com menos frequência.
    const t = setInterval(() => load(batchId), (data?.labels.length ?? 0) > 1500 ? 5000 : 1500);
    return () => clearInterval(t);
  }, [batchId, analyzing, jobRunning, uploading, data?.batch.status, data?.labels.length, load]);

  // Aviso quando a geração termina.
  const lastJobStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    const prev = lastJobStatus.current;
    lastJobStatus.current = job.status;
    if (prev && (prev === "QUEUED" || prev === "PROCESSING")) {
      if (job.status === "COMPLETED") toast("PDF unificado gerado com sucesso.");
      if (job.status === "FAILED") toast("Não foi possível gerar o PDF.", "danger");
    }
  }, [job, toast]);

  // ------------------------------------------------------------------ upload
  const ensureBatch = useCallback(async () => {
    if (batchIdRef.current) return batchIdRef.current;
    creating.current ??= api<{ batch: { id: string } }>("/api/batches", { method: "POST", json: {} }).then((r) => {
      batchIdRef.current = r.batch.id;
      setBatchId(r.batch.id);
      // Troca a URL sem recarregar a página (os envios continuam).
      window.history.replaceState(null, "", `/unificar/${r.batch.id}`);
      return r.batch.id;
    });
    return creating.current;
  }, []);

  const pump = useCallback(async () => {
    while (active.current < UPLOAD_CONCURRENCY && queue.current.length) {
      const item = queue.current.shift()!;
      active.current++;
      (async () => {
        try {
          const id = await ensureBatch();
          setUploads((us) => us.map((u) => (u.key === item.key ? { ...u, status: "uploading" } : u)));
          await uploadWithProgress(`/api/batches/${id}/files`, item.file, (p) =>
            setUploads((us) => us.map((u) => (u.key === item.key ? { ...u, progress: p } : u))),
          );
          setUploads((us) => us.filter((u) => u.key !== item.key));
          await load(id);
        } catch (err) {
          setUploads((us) =>
            us.map((u) => (u.key === item.key ? { ...u, status: "error", error: (err as Error).message } : u)),
          );
        } finally {
          active.current--;
          pump();
        }
      })();
    }
  }, [ensureBatch, load]);

  const addFiles = useCallback(
    (list: File[]) => {
      // Vagas restantes no lote (o servidor também confere).
      const used = (dataRef.current?.files.length ?? 0) + uploadsRef.current.filter((u) => u.status !== "error").length;
      let free = Math.max(0, LIMITS.maxFilesPerBatch - used);
      const items: UploadItem[] = list.map((file) => {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
        const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
        if (!isPdf) return { key, file, progress: 0, status: "error", error: "Não é um arquivo PDF." };
        if (file.size > LIMITS.maxFileSizeMb * 1024 * 1024) {
          return { key, file, progress: 0, status: "error", error: `Maior que ${LIMITS.maxFileSizeMb} MB. Divida o PDF em partes menores.` };
        }
        if (free <= 0) {
          return { key, file, progress: 0, status: "error", error: `Limite de ${LIMITS.maxFilesPerBatch} arquivos por unificação atingido.` };
        }
        free--;
        return { key, file, progress: 0, status: "queued" };
      });
      setUploads((us) => [...us, ...items]);
      queue.current.push(...items.filter((i) => i.status === "queued"));
      pump();
    },
    [pump],
  );

  // ------------------------------------------------------------------ mutações
  async function mutate(fn: () => Promise<unknown>, optimistic?: (d: BatchDetail) => BatchDetail) {
    if (!batchId) return;
    mutating.current++;
    if (optimistic && data) setData(optimistic(data));
    try {
      await fn();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      mutating.current--;
      await load(batchId, true);
    }
  }

  const removeFile = (fileId: string) => {
    setBusyFiles((s) => new Set(s).add(fileId));
    mutate(
      () => api(`/api/batches/${batchId}/files/${fileId}`, { method: "DELETE" }),
      (d) => ({ ...d, files: d.files.filter((f) => f.id !== fileId), labels: d.labels.filter((l) => l.fileId !== fileId) }),
    ).finally(() => setBusyFiles((s) => (s.delete(fileId), new Set(s))));
  };

  const retryFile = (fileId: string) =>
    mutate(
      () => api(`/api/batches/${batchId}/files/${fileId}`, { method: "POST" }),
      (d) => ({ ...d, files: d.files.map((f) => (f.id === fileId ? { ...f, status: "PENDING", error: null } : f)) }),
    );

  const reorder = (ids: string[], sort: SortMode = "CUSTOM") =>
    mutate(
      () => api(`/api/batches/${batchId}/labels`, { method: "PATCH", json: { order: ids, sort } }),
      (d) => {
        const byId = new Map(d.labels.map((l) => [l.id, l]));
        return {
          ...d,
          batch: { ...d.batch, settings: { ...d.batch.settings, sort } },
          labels: ids.map((id, i) => ({ ...byId.get(id)!, position: i })),
        };
      },
    );

  const applySort = (mode: SortMode) => {
    setSettings((s) => (s ? { ...s, sort: mode } : s));
    if (mode === "CUSTOM") {
      return mutate(() => api(`/api/batches/${batchId}/labels`, { method: "PATCH", json: { sort: mode } }));
    }
    reorder(sortLabels(labels, mode).map((l) => l.id), mode);
  };

  const toggleLabel = (id: string, excluded: boolean) =>
    mutate(
      () => api(`/api/batches/${batchId}/labels`, { method: "PATCH", json: { changes: [{ id, excluded }] } }),
      (d) => ({
        ...d,
        labels: d.labels.map((l) =>
          l.id === id
            ? { ...l, excluded, duplicateDecision: l.duplicateType ? (excluded ? "REMOVE" : "KEEP") : l.duplicateDecision }
            : l,
        ),
      }),
    );

  const decide = (id: string, decision: "KEEP" | "REMOVE") =>
    mutate(
      () => api(`/api/batches/${batchId}/labels`, { method: "PATCH", json: { changes: [{ id, decision }] } }),
      (d) => ({
        ...d,
        labels: d.labels.map((l) => (l.id === id ? { ...l, duplicateDecision: decision, excluded: decision === "REMOVE" } : l)),
      }),
    );

  const bulkDuplicates = (bulk: "REMOVE_PENDING_DUPLICATES" | "KEEP_PENDING_DUPLICATES") =>
    mutate(() => api(`/api/batches/${batchId}/labels`, { method: "PATCH", json: { bulk } }));

  const updateSettings = (patch: Partial<OutputSettings>) => {
    setSettings((prev) => {
      const next = normalizeSettings({ ...(prev ?? {}), ...patch });
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(() => {
        if (batchIdRef.current) {
          api(`/api/batches/${batchIdRef.current}`, { method: "PATCH", json: { settings: next } }).catch((err) =>
            toast(`Configuração não salva: ${err.message}`, "danger"),
          );
        }
      }, 400);
      return next;
    });
  };

  const rename = async (name: string) => {
    setEditingName(false);
    if (!batchId || !name.trim() || name === data?.batch.name) return;
    await mutate(() => api(`/api/batches/${batchId}`, { method: "PATCH", json: { name } }));
  };

  async function generate(confirmDuplicates = false) {
    if (!batchId || !settings) return;
    setGenerating(true);
    try {
      if (settingsTimer.current) clearTimeout(settingsTimer.current);
      await api(`/api/batches/${batchId}/generate`, { method: "POST", json: { settings, confirmDuplicates } });
      setConfirmDup(null);
      await load(batchId, true);
    } catch (err) {
      if (err instanceof ClientApiError && err.code === "DUPLICATES_PENDING") {
        setConfirmDup(err.message);
        // Mostra as duplicidades que a conferência do histórico acabou de encontrar.
        load(batchId, true);
      }
      else toast((err as Error).message, "danger");
    } finally {
      setGenerating(false);
    }
  }

  async function deleteBatch() {
    if (!batchId) return;
    try {
      await api(`/api/batches/${batchId}`, { method: "DELETE" });
      toast("Unificação excluída.");
      router.replace("/unificar");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  }

  // ------------------------------------------------------------------ derivados
  const included = labels.filter((l) => !l.excluded);
  const duplicates = labels.filter((l) => l.duplicateType);
  const pendingDup = duplicates.filter((l) => l.duplicateDecision === "PENDING");
  const dupCounts = duplicates.reduce<Record<string, number>>((acc, l) => {
    acc[l.duplicateType!] = (acc[l.duplicateType!] ?? 0) + 1;
    return acc;
  }, {});
  const visible =
    filter === "DUPLICATES" ? labels.filter((l) => l.duplicateType) : filter === "EXCLUDED" ? labels.filter((l) => l.excluded) : labels;
  const errors = files.filter((f) => f.status === "ERROR").length;
  const hasFiles = files.length > 0 || uploads.length > 0;
  const pages = settings ? estimatePages(labels, settings) : 0;
  const canGenerate = !!settings && included.length > 0 && !analyzing && !uploading && !locked;
  const jobDone = job?.status === "COMPLETED";

  if (initialBatchId && !data && !loadError) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (loadError && !data) {
    return <Alert tone="danger" title="Não foi possível abrir esta unificação">{loadError}</Alert>;
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {editingName && data ? (
            <input
              autoFocus
              defaultValue={data.batch.name}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingName(false);
              }}
              className="w-full max-w-lg rounded border border-action px-2 py-1 text-2xl font-semibold focus:outline-none"
              aria-label="Nome da unificação"
            />
          ) : (
            <h1 className="text-2xl font-semibold">
              {data ? (
                <button type="button" onClick={() => setEditingName(true)} className="text-left hover:underline" title="Renomear">
                  {data.batch.name}
                </button>
              ) : (
                "Unificar etiquetas PDF"
              )}
            </h1>
          )}
          <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-2" aria-label="Etapas">
            <Step n={1} title="Enviar PDFs" done={files.some((f) => f.status === "READY")} active={!hasFiles} />
            <Step n={2} title="Revisar e organizar" done={jobDone} active={hasFiles && !jobDone} />
            <Step n={3} title="Configurar impressão" done={jobDone} active={hasFiles && !jobDone} />
            <Step n={4} title="Gerar e baixar" done={jobDone} active={jobRunning} />
          </ol>
        </div>
        {data && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={locked}>
            <Trash2 className="size-4" aria-hidden /> Excluir unificação
          </Button>
        )}
      </div>

      <Dropzone onFiles={addFiles} compact={hasFiles} disabled={locked} maxFileSizeMb={LIMITS.maxFileSizeMb} />

      {!hasFiles && emptyExtra}

      {hasFiles && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <Card
              title="Arquivos"
              description={`${plural(files.length, "arquivo", "arquivos")} · ${plural(
                files.reduce((a, f) => a + (f.pageCount ?? 0), 0),
                "página",
                "páginas",
              )}${errors ? ` · ${plural(errors, "com erro", "com erro")}` : ""}`}
              bodyClassName="px-5 py-2"
            >
              <FilesTable
                files={files}
                uploads={uploads}
                onRemove={removeFile}
                onRetry={retryFile}
                onDismissUpload={(key) => setUploads((us) => us.filter((u) => u.key !== key))}
                busyIds={busyFiles}
                locked={!!locked}
              />
            </Card>

            {duplicates.length > 0 && (
              <section className="overflow-hidden rounded-lg border border-tape bg-tape-soft" aria-label="Duplicidades">
                <div className="tape-stripes h-2" aria-hidden />
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {pendingDup.length
                        ? `${plural(pendingDup.length, "possível duplicidade", "possíveis duplicidades")} para revisar`
                        : "Duplicidades revisadas"}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-soft">
                      {Object.entries(dupCounts)
                        .map(([t, n]) => `${DUPLICATE_LABELS[t as DuplicateType]}: ${n}`)
                        .join(" · ")}
                      . Nenhuma etiqueta é removida sem a sua decisão.
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      Mantidas: {duplicates.filter((l) => !l.excluded).length} · Descartadas: {duplicates.filter((l) => l.excluded).length}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setFilter("DUPLICATES")}>
                      Revisar uma a uma
                    </Button>
                    {pendingDup.length > 0 && !locked && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => bulkDuplicates("KEEP_PENDING_DUPLICATES")}>
                          Manter todas
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => bulkDuplicates("REMOVE_PENDING_DUPLICATES")}>
                          Remover duplicadas
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </section>
            )}

            <Card
              title="Etiquetas"
              description={
                labels.length
                  ? `${formatNumber(included.length)} de ${plural(labels.length, "etiqueta", "etiquetas")} no PDF. Arraste para mudar a ordem.`
                  : undefined
              }
              actions={
                labels.length > 0 && (
                  <>
                    <div className="inline-flex flex-wrap rounded-md border border-line p-0.5 text-sm" role="tablist" aria-label="Filtro">
                      {(
                        [
                          ["ALL", "Todas"],
                          ["DUPLICATES", `Duplicidades (${duplicates.length})`],
                          ["EXCLUDED", `Fora do PDF (${labels.length - included.length})`],
                        ] as const
                      ).map(([f, label]) => (
                        <button
                          key={f}
                          type="button"
                          role="tab"
                          aria-selected={filter === f}
                          onClick={() => {
                            setFilter(f);
                            setShown(PAGE_SIZE);
                          }}
                          className={cx("h-8 rounded px-2.5", filter === f ? "bg-ink text-white" : "text-ink-soft hover:bg-paper")}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-ink-soft">
                      Ordenar por
                      <Select
                        value={settings?.sort ?? "UPLOAD"}
                        onChange={(e) => applySort(e.target.value as SortMode)}
                        disabled={!!locked}
                        className="h-9 w-auto"
                      >
                        {(Object.keys(SORT_MODES) as SortMode[]).map((m) => (
                          <option key={m} value={m}>
                            {SORT_MODES[m]}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </>
                )
              }
            >
              {labels.length === 0 ? (
                <EmptyState icon={<FileStack className="size-8" />} title={analyzing || uploading ? "Analisando arquivos…" : "Nenhuma etiqueta ainda"}>
                  {analyzing || uploading
                    ? "As etiquetas aparecem aqui assim que cada PDF é analisado."
                    : "Envie PDFs válidos para ver as etiquetas identificadas."}
                </EmptyState>
              ) : visible.length === 0 ? (
                <EmptyState title="Nada neste filtro" action={<Button variant="secondary" size="sm" onClick={() => setFilter("ALL")}>Ver todas</Button>} />
              ) : (
                <>
                  <LabelGrid
                    labels={visible.slice(0, shown)}
                    allLabels={labels}
                    sortable={filter === "ALL"}
                    locked={!!locked}
                    onReorder={(ids) => reorder(ids)}
                    onToggle={toggleLabel}
                    onDecision={decide}
                  />
                  {visible.length > shown && (
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-ink-soft">
                      Mostrando {formatNumber(shown)} de {formatNumber(visible.length)} etiquetas.
                      <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                        Mostrar mais {formatNumber(Math.min(PAGE_SIZE, visible.length - shown))}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShown(visible.length)}>
                        Mostrar todas
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>

          {/* Painel lateral: configuração e geração */}
          <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <Card title="Impressão">
              {settings && <SettingsPanel settings={settings} onChange={updateSettings} locked={!!locked} />}
            </Card>

            <section className="rounded-lg border border-line bg-surface p-5">
              <div className="flex items-center gap-3">
                <Layers className="size-5 text-ink-faint" aria-hidden />
                <p className="text-sm text-ink-soft">
                  <strong className="text-ink">{plural(included.length, "etiqueta", "etiquetas")}</strong> em{" "}
                  <strong className="text-ink">{plural(pages, "página", "páginas")}</strong>
                </p>
              </div>
              {pendingDup.length > 0 && (
                <p className="mt-2 text-sm text-tape-ink">
                  <Badge tone="warn">{pendingDup.length}</Badge> duplicidade(s) aguardando revisão.
                </p>
              )}
              {analyzing && <p className="mt-2 text-sm text-ink-soft">Aguardando a análise dos arquivos terminar…</p>}
              <Button
                size="lg"
                className="mt-4 w-full"
                onClick={() => generate(false)}
                loading={generating}
                disabled={!canGenerate}
              >
                <Printer className="size-5" aria-hidden /> {jobDone ? "Gerar novamente" : "Gerar PDF unificado"}
              </Button>
            </section>

            {job && (
              <Card title={jobRunning ? "Gerando PDF" : "Resultado"}>
                <JobSummary job={job} onRetry={() => generate(false)} retrying={generating} />
              </Card>
            )}
          </aside>
        </div>
      )}

      <Modal
        open={!!confirmDup}
        onClose={() => setConfirmDup(null)}
        title="Duplicidades sem revisão"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmDup(null);
                setFilter("DUPLICATES");
              }}
            >
              Revisar agora
            </Button>
            <Button onClick={() => generate(true)} loading={generating}>
              Manter todas e gerar
            </Button>
          </>
        }
      >
        <p>{confirmDup}</p>
        <p className="mt-2">Se continuar, todas as etiquetas marcadas como possível duplicidade serão impressas.</p>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Excluir unificação"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={deleteBatch}>
              Excluir definitivamente
            </Button>
          </>
        }
      >
        Os PDFs enviados, as miniaturas e os PDFs gerados deste lote serão apagados. Esta ação não pode ser desfeita.
      </Modal>
    </div>
  );
}
