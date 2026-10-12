"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, Eye, History, Trash2 } from "lucide-react";
import { JOB_STATUS_LABELS, JobStatusBadge, MarketplaceBadge } from "@/components/badges";
import { Alert, Button, ButtonLink, Card, EmptyState, Input, Modal, PageHeader, ProgressBar, Select, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { MARKETPLACES, marketplaceName } from "@/lib/marketplaces";
import type { JobDto } from "@/lib/serializers";

type Row = JobDto & { batchName: string };
type Filters = { q: string; status: string; marketplace: string; from: string; to: string };
const EMPTY: Filters = { q: "", status: "", marketplace: "", from: "", to: "" };

export default function HistoryPage() {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; jobs: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page) });
    Object.entries(applied).forEach(([k, v]) => v && qs.set(k, v));
    try {
      setData(await api(`/api/jobs?${qs}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Atualiza enquanto houver itens em processamento.
  const running = data?.jobs.some((j) => j.status === "QUEUED" || j.status === "PROCESSING");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [running, load]);

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/api/jobs/${toDelete.id}`, { method: "DELETE" });
      toast("PDF excluído.");
      setToDelete(null);
      load();
    } catch (e) {
      toast((e as Error).message, "danger");
    } finally {
      setDeleting(false);
    }
  }

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = Object.values(applied).some(Boolean);

  return (
    <div>
      <PageHeader
        title="Histórico"
        description="Todos os PDFs unificados da empresa. Os arquivos ficam disponíveis pelo período de retenção definido em Configurações."
        actions={<ButtonLink href="/unificar">Unificar etiquetas PDF</ButtonLink>}
      />

      <form
        className="mb-6 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))_repeat(2,minmax(0,0.9fr))_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(filters);
        }}
      >
        <Input placeholder="Buscar por nome do lote ou arquivo" value={filters.q} onChange={set("q")} aria-label="Buscar" />
        <Select value={filters.status} onChange={set("status")} aria-label="Status">
          <option value="">Status</option>
          {Object.entries(JOB_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={filters.marketplace} onChange={set("marketplace")} aria-label="Marketplace">
          <option value="">Marketplace</option>
          {MARKETPLACES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={filters.from} onChange={set("from")} aria-label="De" />
        <Input type="date" value={filters.to} onChange={set("to")} aria-label="Até" />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY);
                setApplied(EMPTY);
                setPage(1);
              }}
            >
              Limpar
            </Button>
          )}
        </div>
      </form>

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <Card bodyClassName="px-5 py-2">
        {!data ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6" />
          </div>
        ) : data.jobs.length === 0 ? (
          <EmptyState icon={<History className="size-8" />} title={hasFilters ? "Nenhum resultado para os filtros" : "Nenhum PDF gerado ainda"}>
            {hasFilters ? "Ajuste ou limpe os filtros para ver outros resultados." : "Os PDFs unificados aparecem aqui assim que forem gerados."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-faint">
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Unificação</th>
                  <th className="px-3 py-2 font-medium">Marketplaces</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Etiquetas</th>
                  <th className="px-3 py-2 text-right font-medium">Páginas</th>
                  <th className="px-3 py-2 text-right font-medium">Tempo</th>
                  <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                  <th className="py-2 pl-3" />
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.id} className="border-b border-line/70 last:border-0">
                    <td className="whitespace-nowrap py-3 pr-3 text-ink-soft">{formatDateTime(j.queuedAt)}</td>
                    <td className="max-w-[240px] px-3 py-3">
                      <Link href={`/historico/${j.id}`} className="block truncate font-medium hover:underline">
                        {j.batchName}
                      </Link>
                      {j.outputName && <span className="block truncate text-xs text-ink-faint">{j.outputName}</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex max-w-[220px] flex-wrap items-center gap-x-3 gap-y-1">
                        {Object.entries(j.marketplaceCounts)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 2)
                          .map(([mp]) => (
                            <MarketplaceBadge key={mp} id={mp} />
                          ))}
                        {Object.keys(j.marketplaceCounts).length > 2 && (
                          <span className="text-xs text-ink-faint" title={Object.keys(j.marketplaceCounts).map((m) => marketplaceName(m)).join(", ")}>
                            +{Object.keys(j.marketplaceCounts).length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <JobStatusBadge status={j.status} />
                      {(j.status === "QUEUED" || j.status === "PROCESSING") && (
                        <div className="mt-1 w-24">
                          <ProgressBar value={j.progress} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{j.labelsIncluded ? formatNumber(j.labelsIncluded) : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{j.pageCount ? formatNumber(j.pageCount) : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatDuration(j.durationMs)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{formatBytes(j.outputSize)}</td>
                    <td className="py-3 pl-3">
                      <div className="flex justify-end gap-1">
                        <Link href={`/historico/${j.id}`} className="rounded p-1.5 text-ink-soft hover:bg-paper hover:text-ink" aria-label="Ver detalhes" title="Detalhes">
                          <Eye className="size-4" />
                        </Link>
                        {j.downloadable && (
                          <a href={`/api/jobs/${j.id}/download`} className="rounded p-1.5 text-ink-soft hover:bg-paper hover:text-ink" aria-label="Baixar PDF" title="Baixar">
                            <Download className="size-4" />
                          </a>
                        )}
                        {j.status !== "QUEUED" && j.status !== "PROCESSING" && (
                          <button
                            type="button"
                            onClick={() => setToDelete(j)}
                            className="rounded p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger"
                            aria-label="Excluir PDF"
                            title="Excluir"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
          <span className="text-ink-soft">
            Página {page} de {pages} · {formatNumber(data.total)} registros
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Próxima
            </Button>
          </div>
        </nav>
      )}

      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Excluir PDF unificado"
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={remove} loading={deleting}>
              Excluir PDF
            </Button>
          </>
        }
      >
        O arquivo {toDelete?.outputName ?? ""} será apagado definitivamente e sai do histórico. Os PDFs de origem não são afetados.
      </Modal>
    </div>
  );
}
