"use client";

import { getMarketplace } from "@/lib/marketplaces";
import { Badge } from "./ui";

export function MarketplaceBadge({ id, className }: { id: string | null | undefined; className?: string }) {
  const mp = getMarketplace(id);
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-ink-soft ${className ?? ""}`}>
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: mp.color }} aria-hidden />
      {mp.name}
    </span>
  );
}

const JOB_STATUS = {
  QUEUED: { label: "Na fila", tone: "info" },
  PROCESSING: { label: "Processando", tone: "info" },
  COMPLETED: { label: "Concluído", tone: "ok" },
  FAILED: { label: "Falhou", tone: "danger" },
  EXPIRED: { label: "Expirado", tone: "neutral" },
} as const;

export function JobStatusBadge({ status }: { status: keyof typeof JOB_STATUS }) {
  const s = JOB_STATUS[status] ?? JOB_STATUS.QUEUED;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const JOB_STATUS_LABELS = Object.fromEntries(Object.entries(JOB_STATUS).map(([k, v]) => [k, v.label])) as Record<
  keyof typeof JOB_STATUS,
  string
>;

const FILE_STATUS = {
  PENDING: { label: "Na fila", tone: "neutral" },
  ANALYZING: { label: "Analisando", tone: "info" },
  READY: { label: "Pronto", tone: "ok" },
  ERROR: { label: "Erro", tone: "danger" },
} as const;

export function FileStatusBadge({ status }: { status: keyof typeof FILE_STATUS }) {
  const s = FILE_STATUS[status] ?? FILE_STATUS.PENDING;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
