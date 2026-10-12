/**
 * Limpeza periódica: aplica a política de retenção (LGPD) e encerra
 * processamentos travados.
 */
import { db } from "../../lib/db";
import { keys, storage } from "../../lib/storage";

export async function runMaintenance() {
  const now = new Date();
  const stats = { outputs: 0, batches: 0, stuck: 0, sessions: 0, drafts: 0 };

  // 1) PDFs unificados vencidos.
  const expired = await db.job.findMany({
    where: { status: "COMPLETED", expiresAt: { lt: now }, outputKey: { not: null } },
    select: { id: true, outputKey: true },
    take: 500,
  });
  for (const job of expired) {
    await storage().delete(job.outputKey!).catch(() => undefined);
    await db.job.update({ where: { id: job.id }, data: { status: "EXPIRED", outputKey: null } });
    stats.outputs++;
  }

  // 2) Arquivos de origem e miniaturas além do período de retenção de cada empresa.
  const orgs = await db.organization.findMany({ select: { id: true, retentionDays: true } });
  for (const org of orgs) {
    const cutoff = new Date(now.getTime() - org.retentionDays * 86_400_000);
    const batches = await db.batch.findMany({
      where: { orgId: org.id, updatedAt: { lt: cutoff }, status: { not: "GENERATING" }, files: { some: { purgedAt: null } } },
      select: { id: true },
      take: 200,
    });
    for (const b of batches) {
      await storage().deletePrefix(keys.batchPrefix(org.id, b.id));
      await db.sourceFile.updateMany({ where: { batchId: b.id, purgedAt: null }, data: { purgedAt: now } });
      await db.label.updateMany({ where: { batchId: b.id }, data: { thumbnailKey: null } });
      stats.batches++;
    }
  }

  // 3) Processamentos travados (worker reiniciado no meio de uma geração).
  const stuckBefore = new Date(now.getTime() - 2 * 3600_000);
  const stuck = await db.job.findMany({
    where: { status: { in: ["QUEUED", "PROCESSING"] }, queuedAt: { lt: stuckBefore } },
    select: { id: true, batchId: true },
  });
  for (const job of stuck) {
    await db.job.update({
      where: { id: job.id },
      data: { status: "FAILED", error: "O processamento excedeu o tempo limite. Gere o PDF novamente.", finishedAt: now },
    });
    await db.batch.updateMany({ where: { id: job.batchId, status: "GENERATING" }, data: { status: "READY" } });
    stats.stuck++;
  }

  // 4) Sessões e tokens vencidos; rascunhos vazios abandonados.
  stats.sessions = (await db.session.deleteMany({ where: { expiresAt: { lt: now } } })).count;
  await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } });
  stats.drafts = (
    await db.batch.deleteMany({
      where: { status: "DRAFT", files: { none: {} }, createdAt: { lt: new Date(now.getTime() - 86_400_000) } },
    })
  ).count;

  return stats;
}
