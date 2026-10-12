import { ApiError, json, requireSession, route, type IdParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { serializeFile, serializeJob } from "@/lib/serializers";
import { storage } from "@/lib/storage";

export const GET = route(async (_req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const job = await db.job.findFirst({
    where: { id, orgId: s.org.id, deletedAt: null },
    include: { batch: { include: { files: { orderBy: { uploadIndex: "asc" } } } } },
  });
  if (!job) throw new ApiError(404, "Processamento não encontrado.");
  const creator = await db.user.findUnique({ where: { id: job.createdById }, select: { name: true } });
  return json({
    job: { ...serializeJob(job), batchName: job.batch.name, createdBy: creator?.name ?? "Usuário removido" },
    files: job.batch.files.map(serializeFile),
  });
});

/** Exclui o PDF gerado (o registro permanece no histórico como excluído). */
export const DELETE = route(async (_req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const job = await db.job.findFirst({ where: { id, orgId: s.org.id, deletedAt: null } });
  if (!job) throw new ApiError(404, "Processamento não encontrado.");
  if (job.status === "QUEUED" || job.status === "PROCESSING") throw new ApiError(409, "Aguarde o processamento terminar.");
  if (job.outputKey) await storage().delete(job.outputKey);
  await db.job.update({ where: { id }, data: { deletedAt: new Date(), outputKey: null } });
  await audit(s.org.id, s.user.id, "job.deleted", id);
  return json({ ok: true });
});
