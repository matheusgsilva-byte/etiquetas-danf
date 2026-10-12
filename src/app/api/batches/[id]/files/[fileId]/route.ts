import { ApiError, json, requireSession, route } from "@/lib/api";
import { recomputeDuplicates, refreshBatchStatus } from "@/lib/batch-service";
import { db } from "@/lib/db";
import { enqueueAnalyze } from "@/lib/queue";
import { keys, storage } from "@/lib/storage";

type Params = { params: Promise<{ id: string; fileId: string }> };

async function findFile(orgId: string, batchId: string, fileId: string) {
  const file = await db.sourceFile.findFirst({ where: { id: fileId, batchId, orgId }, include: { batch: true } });
  if (!file) throw new ApiError(404, "Arquivo não encontrado.");
  if (file.batch.status === "GENERATING") throw new ApiError(409, "Aguarde a geração do PDF terminar.");
  return file;
}

/** Remove um arquivo (e suas etiquetas) do lote antes da unificação. */
export const DELETE = route(async (_req, { params }: Params) => {
  const s = await requireSession();
  const { id, fileId } = await params;
  const file = await findFile(s.org.id, id, fileId);
  const pages = file.pageCount ?? 0;
  await db.sourceFile.delete({ where: { id: fileId } });
  await storage().delete(file.storageKey).catch(() => undefined);
  for (let i = 0; i < pages; i++) {
    await storage().delete(keys.thumbnail(s.org.id, id, fileId, i)).catch(() => undefined);
  }
  await recomputeDuplicates(id);
  await refreshBatchStatus(id);
  return json({ ok: true });
});

/** Reprocessa um arquivo que falhou por indisponibilidade temporária. */
export const POST = route(async (_req, { params }: Params) => {
  const s = await requireSession();
  const { id, fileId } = await params;
  const file = await findFile(s.org.id, id, fileId);
  if (file.status !== "ERROR") throw new ApiError(400, "Este arquivo não precisa ser reprocessado.");
  if (file.purgedAt) throw new ApiError(410, "O arquivo já foi excluído pela política de retenção.");
  await db.sourceFile.update({ where: { id: fileId }, data: { status: "PENDING", error: null } });
  await enqueueAnalyze(fileId);
  await refreshBatchStatus(id);
  return json({ ok: true });
});
