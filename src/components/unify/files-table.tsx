"use client";

import { Copy, RotateCw, Trash2, Wrench, X } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { FileStatusBadge, MarketplaceBadge } from "../badges";
import { Badge, ProgressBar, Spinner } from "../ui";
import type { FileDto, UploadItem } from "./types";

export function FilesTable({
  files,
  uploads,
  onRemove,
  onRetry,
  onDismissUpload,
  busyIds,
  locked,
}: {
  files: FileDto[];
  uploads: UploadItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onDismissUpload: (key: string) => void;
  busyIds: Set<string>;
  locked: boolean;
}) {
  const nameById = new Map(files.map((f) => [f.id, f.name]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-ink-faint">
            <th className="py-2 pr-3 font-medium">Arquivo</th>
            <th className="px-3 py-2 font-medium">Origem</th>
            <th className="px-3 py-2 text-right font-medium">Tamanho</th>
            <th className="px-3 py-2 text-right font-medium">Páginas</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="w-10 py-2 pl-3" />
          </tr>
        </thead>
        <tbody>
          {uploads.map((u) => (
            <tr key={u.key} className="border-b border-line/70 last:border-0">
              <td className="max-w-[280px] py-2.5 pr-3">
                <p className="truncate font-medium" title={u.file.name}>
                  {u.file.name}
                </p>
                {u.status === "error" && <p className="text-xs text-danger">{u.error}</p>}
              </td>
              <td className="px-3 py-2.5 text-ink-faint">—</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{formatBytes(u.file.size)}</td>
              <td className="px-3 py-2.5 text-right text-ink-faint">—</td>
              <td className="px-3 py-2.5">
                {u.status === "error" ? (
                  <Badge tone="danger">Não enviado</Badge>
                ) : u.status === "queued" ? (
                  <Badge>Aguardando envio</Badge>
                ) : (
                  <div className="w-28">
                    <ProgressBar value={u.progress * 100} label={`Enviando ${u.file.name}`} />
                    <p className="mt-1 text-xs text-ink-faint">Enviando {Math.round(u.progress * 100)}%</p>
                  </div>
                )}
              </td>
              <td className="py-2.5 pl-3 text-right">
                {u.status === "error" && (
                  <button type="button" onClick={() => onDismissUpload(u.key)} className="rounded p-1.5 text-ink-faint hover:bg-paper hover:text-ink" aria-label="Dispensar">
                    <X className="size-4" />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {files.map((f) => (
            <tr key={f.id} className="border-b border-line/70 last:border-0">
              <td className="max-w-[280px] py-2.5 pr-3">
                <p className="truncate font-medium" title={f.name}>
                  {f.name}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {f.duplicateOfFileId && (
                    <Badge tone="warn" title={`Idêntico a ${nameById.get(f.duplicateOfFileId) ?? "outro arquivo"}`}>
                      <Copy className="size-3" aria-hidden /> Arquivo repetido
                    </Badge>
                  )}
                  {f.repaired && (
                    <Badge tone="info" title="O PDF estava protegido ou danificado e foi normalizado para poder ser unificado.">
                      <Wrench className="size-3" aria-hidden /> Normalizado
                    </Badge>
                  )}
                </div>
                {f.status === "ERROR" && f.error && <p className="mt-0.5 text-xs text-danger">{f.error}</p>}
              </td>
              <td className="px-3 py-2.5">{f.status === "READY" ? <MarketplaceBadge id={f.marketplace} /> : <span className="text-ink-faint">—</span>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{formatBytes(f.sizeBytes)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{f.pageCount ?? "—"}</td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <FileStatusBadge status={f.status} />
                  {(f.status === "ANALYZING" || f.status === "PENDING") && <Spinner className="size-3.5" />}
                </span>
              </td>
              <td className="py-2.5 pl-3">
                <div className="flex justify-end gap-1">
                  {f.status === "ERROR" && !f.error?.includes("limite") && (
                    <button
                      type="button"
                      disabled={locked || busyIds.has(f.id)}
                      onClick={() => onRetry(f.id)}
                      className="rounded p-1.5 text-ink-faint hover:bg-paper hover:text-ink disabled:opacity-40"
                      aria-label={`Reprocessar ${f.name}`}
                      title="Reprocessar"
                    >
                      <RotateCw className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={locked || busyIds.has(f.id)}
                    onClick={() => onRemove(f.id)}
                    className="rounded p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                    aria-label={`Remover ${f.name}`}
                    title="Remover do lote"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
