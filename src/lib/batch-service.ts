/**
 * Regras de estado do lote compartilhadas entre API e worker.
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { detectDuplicates, isNfeKey } from "./duplicates";

/** Janela em que uma remessa já impressa é considerada "repetida" (dias). */
const HISTORY_WINDOW_DAYS = 60;

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const formatDateTime = (d: Date) => dateTimeFmt.format(d).replace(",", " às");

/**
 * Registra as chaves de DANFE de um PDF gerado (a primeira impressão é mantida).
 */
export async function recordPrintedKeys(
  tx: Prisma.TransactionClient,
  data: { orgId: string; batchId: string; batchName: string; jobId: string; printedAt: Date; keys: string[] },
) {
  const keys = [...new Set(data.keys.filter(isNfeKey))];
  if (!keys.length) return;
  await tx.printedKey.createMany({
    data: keys.map((key) => ({
      orgId: data.orgId,
      key,
      batchId: data.batchId,
      batchName: data.batchName,
      jobId: data.jobId,
      printedAt: data.printedAt,
    })),
    skipDuplicates: true,
  });
}

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
          duplicateNote: true,
          excluded: true,
        },
      });

      const shipmentKeys = [...new Set(labels.map((l) => l.shipmentKey).filter((k): k is string => !!k))];
      const historyKeys = new Map<string, string>();

      // DANFE: a mesma chave de acesso nunca pode sair duas vezes — histórico completo,
      // guardado à parte para valer mesmo depois que os lotes antigos são apagados.
      const nfeKeys = shipmentKeys.filter(isNfeKey);
      if (nfeKeys.length) {
        const printed = await tx.printedKey.findMany({
          where: { orgId: batch.orgId, key: { in: nfeKeys }, batchId: { not: batchId } },
          select: { key: true, batchName: true, printedAt: true },
        });
        for (const p of printed) {
          historyKeys.set(p.key, `DANFE já impressa em ${formatDateTime(p.printedAt)} (${p.batchName}).`);
        }
      }

      // Demais remessas (rastreio / nº do pedido): janela recente.
      const otherKeys = shipmentKeys.filter((k) => !isNfeKey(k));
      if (otherKeys.length) {
        const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86_400_000);
        const previous = await tx.label.findMany({
          where: {
            shipmentKey: { in: otherKeys },
            batchId: { not: batchId },
            excluded: false,
            batch: { orgId: batch.orgId, jobs: { some: { status: "COMPLETED", finishedAt: { gte: since } } } },
          },
          select: { shipmentKey: true },
          distinct: ["shipmentKey"],
        });
        previous.forEach((p) => p.shipmentKey && historyKeys.set(p.shipmentKey, ""));
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
          const note = dup.note || null;
          if (dup.type !== l.duplicateType || dup.duplicateOfId !== l.duplicateOfId || note !== l.duplicateNote) {
            const sameType = dup.type === l.duplicateType && l.duplicateDecision;
            data = {
              duplicateType: dup.type,
              duplicateOfId: dup.duplicateOfId,
              duplicateNote: note,
              duplicateDecision: sameType ? l.duplicateDecision : "PENDING",
            };
          }
        } else if (l.duplicateType) {
          // Deixou de ser duplicada (ex.: a original foi removida). Volta a ser incluída
          // somente se tinha sido excluída pela decisão de duplicidade.
          data = {
            duplicateType: null,
            duplicateOfId: null,
            duplicateNote: null,
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
