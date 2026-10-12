"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { FileStatusBadge, JobStatusBadge, MarketplaceBadge } from "@/components/badges";
import { JobSummary } from "@/components/job-result";
import { Alert, ButtonLink, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { describeSettings } from "@/lib/output-settings";
import type { FileDto, JobDto } from "@/lib/serializers";

type Detail = { job: JobDto & { batchName: string; createdBy: string }; files: FileDto[] };

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Detail>(`/api/jobs/${id}`)
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => load(), [load]);
  const running = data?.job.status === "QUEUED" || data?.job.status === "PROCESSING";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [running, load]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!data) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  const { job, files } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/historico" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Histórico
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{job.batchName}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              Solicitado por {job.createdBy} em {formatDateTime(job.queuedAt)} · {describeSettings(job.settings)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <JobStatusBadge status={job.status} />
            {!files.every((f) => f.purged) && (
              <ButtonLink href={`/unificar/${job.batchId}`} variant="secondary" size="sm">
                Abrir lote
              </ButtonLink>
            )}
          </div>
        </div>
      </div>

      <Card title="Resultado">
        <JobSummary job={job} />
      </Card>

      <Card title="Arquivos de origem" bodyClassName="px-5 py-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                <th className="py-2 pr-3 font-medium">Arquivo</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2 text-right font-medium">Páginas</th>
                <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                <th className="px-3 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-b border-line/70 last:border-0">
                  <td className="max-w-[320px] truncate py-2.5 pr-3 font-medium" title={f.name}>
                    {f.name}
                  </td>
                  <td className="px-3 py-2.5">
                    <MarketplaceBadge id={f.marketplace} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{f.pageCount ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-3 py-2.5">{f.purged ? <span className="text-ink-faint">Excluído (retenção)</span> : <FileStatusBadge status={f.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
