"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { formatDateTime, plural } from "@/lib/format";
import { Badge } from "../ui";

type Item = { id: string; name: string; status: string; updatedAt: string; files: number; labels: number };

const STATUS: Record<string, string> = {
  DRAFT: "Rascunho",
  ANALYZING: "Analisando",
  READY: "Pronta para gerar",
  GENERATING: "Gerando",
  FAILED: "Falhou",
};

/** Unificações iniciadas e ainda não concluídas, para retomar. */
export function ResumeList() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    api<{ batches: Item[] }>("/api/batches")
      .then((r) => setItems(r.batches))
      .catch(() => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Continuar de onde parou</h2>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {items.map((b) => (
          <li key={b.id}>
            <Link href={`/unificar/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-paper">
              <span className="min-w-0">
                <span className="block truncate font-medium">{b.name}</span>
                <span className="text-sm text-ink-faint">
                  {plural(b.files, "arquivo", "arquivos")} · {plural(b.labels, "etiqueta", "etiquetas")} · {formatDateTime(b.updatedAt)}
                </span>
              </span>
              <Badge tone={b.status === "FAILED" ? "danger" : b.status === "READY" ? "info" : "neutral"}>{STATUS[b.status] ?? b.status}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
