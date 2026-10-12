"use client";

import { Clock, Download, Eye } from "lucide-react";
import { describeSettings } from "@/lib/output-settings";
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import type { JobDto } from "@/lib/serializers";
import { MarketplaceBadge } from "./badges";
import { Alert, Button, ProgressBar, buttonClass } from "./ui";

export function JobProgress({ job }: { job: JobDto }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium">{job.stage ?? "Na fila"}</p>
        <span className="text-sm tabular-nums text-ink-soft">{job.progress}%</span>
      </div>
      <ProgressBar value={job.status === "QUEUED" ? 2 : job.progress} label="Progresso da geração" />
      <p className="text-sm text-ink-faint">
        Pode continuar usando a plataforma. Quando terminar, o PDF também fica disponível no Histórico.
      </p>
    </div>
  );
}

export function JobSummary({ job, onRetry, retrying }: { job: JobDto; onRetry?: () => void; retrying?: boolean }) {
  if (job.status === "QUEUED" || job.status === "PROCESSING") return <JobProgress job={job} />;

  if (job.status === "FAILED") {
    return (
      <Alert
        tone="danger"
        title="O PDF não foi gerado"
        action={
          onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>
              Tentar novamente
            </Button>
          )
        }
      >
        {job.error ?? "Ocorreu um erro inesperado."} Nenhum arquivo incompleto foi disponibilizado.
      </Alert>
    );
  }

  if (job.status === "EXPIRED") {
    return (
      <Alert tone="neutral" title="PDF expirado">
        Este PDF foi excluído automaticamente pela política de retenção em {formatDateTime(job.expiresAt)}.
      </Alert>
    );
  }

  const stats: [string, string][] = [
    ["Etiquetas no PDF", formatNumber(job.labelsIncluded)],
    ["Páginas", formatNumber(job.pageCount)],
    ["Arquivos de origem", formatNumber(job.filesCount)],
    ["Descartadas", formatNumber(job.labelsDiscarded)],
    ["Tempo de processamento", formatDuration(job.durationMs)],
    ["Tamanho do PDF", formatBytes(job.outputSize)],
  ];
  const mps = Object.entries(job.marketplaceCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-semibold">PDF pronto para impressão</p>
          <p className="truncate text-sm text-ink-soft">
            {job.outputName} · {describeSettings(job.settings)}
          </p>
        </div>
        {job.downloadable && (
          <div className="flex flex-wrap gap-2">
            <a href={`/api/jobs/${job.id}/download?inline=1`} target="_blank" rel="noopener" className={buttonClass("secondary")}>
              <Eye className="size-4" aria-hidden /> Visualizar
            </a>
            <a href={`/api/jobs/${job.id}/download`} className={buttonClass("primary")}>
              <Download className="size-4" aria-hidden /> Baixar PDF
            </a>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-ink-faint">{k}</dt>
            <dd className="text-lg font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {mps.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Por marketplace</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
            {mps.map(([mp, n]) => (
              <li key={mp} className="flex items-center gap-2 text-sm">
                <MarketplaceBadge id={mp} /> <span className="tabular-nums font-medium">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {job.warnings.length > 0 && (
        <Alert tone="warn" title={`${job.warnings.length} etiqueta(s) precisaram ser reduzidas`}>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {job.warnings.slice(0, 8).map((w, i) => (
              <li key={i}>
                <strong className="font-medium text-ink">{w.ref}</strong>: {w.message}
              </li>
            ))}
          </ul>
          {job.warnings.length > 8 && <p className="mt-1">E mais {job.warnings.length - 8}.</p>}
        </Alert>
      )}

      {job.expiresAt && (
        <p className="flex items-center gap-1.5 text-xs text-ink-faint">
          <Clock className="size-3.5" aria-hidden /> Disponível para download até {formatDateTime(job.expiresAt)}.
        </p>
      )}
    </div>
  );
}
