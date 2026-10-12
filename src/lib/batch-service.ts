/**
 * Regras de estado do lote compartilhadas entre API e worker.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { detectDuplicates } from "./duplicates";

/** Janela em que uma remessa já impressa é considerada "repetida" (dias). */
const HISTORY_WINDOW_DAYS = 60;

/**
 * Recalcula as duplicidades do lote inteiro. Usa um lock consultivo do
 * PostgreSQL para que análises paralelas do mesmo lote não conflitem.
 * Decisões já tomadas pelo usuário (manter/remover) são preservadas quando o
 * tipo de duplicidade continua o mesmo.
 */
export async function recomputeDuplicates(batchId: string) {
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${batchId}))`;
      const batch = await tx.batch.findUnique({ where: { id: batchId }, select: { orgId: true } });
      if (!batch) return;

      const files = await tx.sourceFile.findMany({
        where: { batchId, status: "READY" },
        select: { id: true, sha256: true, uploadIndex: true, duplicateOfFileId: true },
      });
      const labels = await tx.label.findMany({
        where: { batchId, fileId: { in: files.map((f) => f.id) } },
        select: {
          id: true,
          fileId: true,
          pageIndex: true,
          fingerprint: true,
          shipmentKey: true,
          blank: true,
          duplicateType: true,
          duplicateOfId: true,
          duplicateDecision: true,
          excluded: true,
        },
      });

      const shipmentKeys = [...new Set(labels.map((l) => l.shipmentKey).filter((k): k is string => !!k))];
      const historyKeys = new Set<string>();
      if (shipmentKeys.length) {
        const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);
        const previous = await tx.label.findMany({
          where: {
            shipmentKey: { in: shipmentKeys },
            batchId: { not: batchId },
            excluded: false,
            batch: { orgId: batch.orgId, jobs: { some: { status: "COMPLETED", finishedAt: { gte: since } } } },
          },
          select: { shipmentKey: true },
          distinct: ["shipmentKey"],
        });
        previous.forEach((p) => p.shipmentKey && historyKeys.add(p.shipmentKey));
      }

      const result = detectDuplicates(files, labels, historyKeys);

      for (const f of files) {
        const dupOf = result.files.get(f.id) ?? null;
        if (dupOf !== f.duplicateOfFileId) {
          await tx.sourceFile.update({ where: { id: f.id }, data: { duplicateOfFileId: dupOf } });
        }
      }

      for (const l of labels) {
        const dup = result.labels.get(l.id);
        let data: Prisma.LabelUpdateInput | null = null;
        if (dup) {
          if (dup.type !== l.duplicateType || dup.duplicateOfId !== l.duplicateOfId) {
            const sameType = dup.type === l.duplicateType && l.duplicateDecision;
            data = {
              duplicateType: dup.type,
              duplicateOfId: dup.duplicateOfId,
              duplicateDecision: sameType ? l.duplicateDecision : "PENDING",
            };
          }
        } else if (l.duplicateType) {
          // Deixou de ser duplicada (ex.: a original foi removida). Volta a ser incluída
          // somente se tinha sido excluída pela decisão de duplicidade.
          data = {
            duplicateType: null,
            duplicateOfId: null,
            duplicateDecision: null,
            excluded: l.duplicateDecision === "REMOVE" ? false : l.excluded,
          };
        }
        if (data) await tx.label.update({ where: { id: l.id }, data });
      }
    },
    { timeout: 60_000 },
  );
}

/** Atualiza o status do lote de acordo com seus arquivos. */
export async function refreshBatchStatus(batchId: string) {
  const batch = await db.batch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (!batch || batch.status === "GENERATING") return;
  const counts = await db.sourceFile.groupBy({ by: ["status"], where: { batchId }, _count: true });
  const by = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>;
  const total = counts.reduce((a, c) => a + c._count, 0);
  let status: "DRAFT" | "ANALYZING" | "READY" = "READY";
  if (total === 0) status = "DRAFT";
  else if ((by.PENDING ?? 0) + (by.ANALYZING ?? 0) > 0) status = "ANALYZING";
  if (status !== batch.status) await db.batch.update({ where: { id: batchId }, data: { status } });
}

/** Status em que o lote aceita alterações (upload, ordem, decisões). */
export const EDITABLE_BATCH_STATUSES = ["DRAFT", "ANALYZING", "READY", "COMPLETED", "FAILED"] as const;
