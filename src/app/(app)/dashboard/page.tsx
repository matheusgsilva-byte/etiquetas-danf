"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, FilePlus2, Inbox } from "lucide-react";
import { JobStatusBadge, MarketplaceBadge } from "@/components/badges";
import { Alert, ButtonLink, Card, cx, EmptyState, ProgressBar, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { getMarketplace } from "@/lib/marketplaces";
import type { JobDto } from "@/lib/serializers";

interface Dashboard {
  days: number;
  totals: {
    filesImported: number;
    labelsIdentified: number;
    labelsPrinted: number;
    labelsDiscarded: number;
    pagesGenerated: number;
    pdfsGenerated: number;
    avgDurationMs: number | null;
    activeJobs: number;
  };
  byMarketplace: Record<string, number>;
  statusCounts: Record<string, number>;
  daily: { date: string; labels: number }[];
  recent: (JobDto & { batchName: string })[];
  usage: { labelsThisMonth: number; storageBytes: number; members: number };
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-ink-faint">{note}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchData = () =>
      api<Dashboard>(`/api/dashboard?days=${days}`)
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e.message));
    fetchData();
    const t = setInterval(fetchData, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [days]);

  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.labels) ?? [1]));
  const mps = Object.entries(data?.byMarketplace ?? {}).sort((a, b) => b[1] - a[1]);
  const maxMp = Math.max(1, ...mps.map(([, n]) => n));

  return (
    <div className="space-y-6">
      {/* Ação principal */}
      <section className="flex flex-wrap items-center justify-between gap-6 overflow-hidden rounded-lg bg-ink px-6 py-7 text-white sm:px-8">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold sm:text-[28px]">Etiquetas do dia, um PDF só.</h1>
          <p className="mt-2 text-white/70">
            Envie os PDFs de todos os marketplaces de uma vez. O LabelHub identifica cada etiqueta, aponta duplicidades e monta o arquivo pronto
            para a impressora.
          </p>
        </div>
        <Link href="/unificar" className="inline-flex h-12 items-center gap-2 rounded-md bg-white px-6 font-medium text-ink transition-colors hover:bg-action-soft">
          <FilePlus2 className="size-5" aria-hidden /> Unificar etiquetas PDF
        </Link>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Visão geral</h2>
        <div className="inline-flex rounded-md border border-line bg-surface p-0.5 text-sm" role="tablist" aria-label="Período">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={days === d}
              onClick={() => setDays(d)}
              className={cx("h-8 rounded px-3", days === d ? "bg-ink text-white" : "text-ink-soft hover:bg-paper")}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Arquivos importados" value={formatNumber(data.totals.filesImported)} />
            <Metric label="Etiquetas identificadas" value={formatNumber(data.totals.labelsIdentified)} />
            <Metric label="Etiquetas impressas" value={formatNumber(data.totals.labelsPrinted)} note={`${formatNumber(data.totals.labelsDiscarded)} descartadas`} />
            <Metric label="Páginas geradas" value={formatNumber(data.totals.pagesGenerated)} />
            <Metric label="PDFs unificados" value={formatNumber(data.totals.pdfsGenerated)} note={data.totals.activeJobs ? `${data.totals.activeJobs} em processamento` : undefined} />
            <Metric label="Tempo médio por lote" value={formatDuration(data.totals.avgDurationMs)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card title="Etiquetas impressas por dia">
              {data.totals.labelsPrinted === 0 ? (
                <EmptyState icon={<Inbox className="size-7" />} title="Nenhum PDF gerado no período" />
              ) : (
                <div className="flex h-44 items-end gap-[3px]" role="img" aria-label="Gráfico de etiquetas impressas por dia">
                  {data.daily.map((d) => (
                    <div key={d.date} className="group relative flex h-full flex-1 items-end">
                      <div
                        className={cx("w-full rounded-t-sm", d.labels ? "bg-action" : "bg-line")}
                        style={{ height: d.labels ? `${Math.max(4, (d.labels / maxDaily) * 100)}%` : 2 }}
                      />
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-white group-hover:block">
                        {new Date(`${d.date}T12:00:00`).toLocaleDateString("pt-BR")}: {d.labels}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Etiquetas por marketplace">
              {mps.length === 0 ? (
                <p className="text-sm text-ink-faint">Os marketplaces aparecem aqui depois do primeiro PDF gerado.</p>
              ) : (
                <ul className="space-y-3">
                  {mps.map(([mp, n]) => (
                    <li key={mp}>
                      <div className="flex justify-between text-sm">
                        <MarketplaceBadge id={mp} />
                        <span className="tabular-nums font-medium">{formatNumber(n)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-line">
                        <div className="h-full rounded-full" style={{ width: `${(n / maxMp) * 100}%`, background: getMarketplace(mp).color }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card
              title="Últimas operações"
              actions={
                <ButtonLink href="/historico" variant="ghost" size="sm">
                  Ver histórico
                </ButtonLink>
              }
              bodyClassName="px-5 py-2"
            >
              {data.recent.length === 0 ? (
                <EmptyState title="Nenhuma unificação ainda" action={<ButtonLink href="/unificar">Unificar etiquetas PDF</ButtonLink>}>
                  Envie seus PDFs para gerar o primeiro arquivo.
                </EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-ink-faint">
                        <th className="py-2 pr-3 font-medium">Unificação</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">Etiquetas</th>
                        <th className="px-3 py-2 text-right font-medium">Tempo</th>
                        <th className="w-10 py-2 pl-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.map((j) => (
                        <tr key={j.id} className="border-b border-line/70 last:border-0">
                          <td className="max-w-[260px] py-2.5 pr-3">
                            <Link href={`/historico/${j.id}`} className="block truncate font-medium hover:underline">
                              {j.batchName}
                            </Link>
                            <span className="text-xs text-ink-faint">{formatDateTime(j.queuedAt)}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <JobStatusBadge status={j.status} />
                            {(j.status === "PROCESSING" || j.status === "QUEUED") && (
                              <div className="mt-1 w-24">
                                <ProgressBar value={j.progress} />
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{j.status === "COMPLETED" ? formatNumber(j.labelsIncluded) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{formatDuration(j.durationMs)}</td>
                          <td className="py-2.5 pl-3 text-right">
                            {j.downloadable && (
                              <a href={`/api/jobs/${j.id}/download`} className="inline-flex rounded p-1.5 text-ink-soft hover:bg-paper hover:text-ink" aria-label={`Baixar ${j.outputName}`}>
                                <Download className="size-4" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Uso neste mês">
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Etiquetas unificadas</dt>
                  <dd className="tabular-nums font-medium">{formatNumber(data.usage.labelsThisMonth)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Armazenamento em uso</dt>
                  <dd className="tabular-nums font-medium">{formatBytes(data.usage.storageBytes)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Usuários</dt>
                  <dd className="tabular-nums font-medium">{formatNumber(data.usage.members)}</dd>
                </div>
              </dl>
              <p className="mt-4 text-sm text-ink-faint">Sem limites de etiquetas, arquivos ou usuários.</p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
