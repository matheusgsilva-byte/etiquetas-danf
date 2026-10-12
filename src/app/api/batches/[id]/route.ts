import { z } from "zod";
import { ApiError, json, parseBody, requireSession, route, type IdParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { outputSettingsSchema, normalizeSettings } from "@/lib/output-settings";
import { serializeBatch, serializeFile, serializeJob, serializeLabel } from "@/lib/serializers";
import { keys, storage } from "@/lib/storage";

async function loadBatch(orgId: string, id: string) {
  const batch = await db.batch.findFirst({ where: { id, orgId } });
  if (!batch) throw new ApiError(404, "Unificação não encontrada.");
  return batch;
}

export const GET = route(async (_req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const batch = await loadBatch(s.org.id, id);
  const [files, labels, job] = await Promise.all([
    db.sourceFile.findMany({ where: { batchId: id }, orderBy: { uploadIndex: "asc" } }),
    db.label.findMany({ where: { batchId: id }, orderBy: [{ position: "asc" }] }),
    db.job.findFirst({ where: { batchId: id }, orderBy: { queuedAt: "desc" } }),
  ]);
  const fileById = new Map(files.map((f) => [f.id, f]));
  return json({
    batch: serializeBatch(batch),
    files: files.map(serializeFile),
    labels: labels.filter((l) => fileById.has(l.fileId)).map((l) => serializeLabel(l, fileById.get(l.fileId)!)),
    job: job ? serializeJob(job) : null,
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: outputSettingsSchema.partial().optional(),
});

export const PATCH = route(async (req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const batch = await loadBatch(s.org.id, id);
  const body = await parseBody(req, patchSchema);
  const updated = await db.batch.update({
    where: { id: batch.id },
    data: {
      name: body.name,
      settings: body.settings ? normalizeSettings({ ...normalizeSettings(batch.settings), ...body.settings }) : undefined,
    },
  });
  return json({ batch: serializeBatch(updated) });
});

/** Exclui o lote, os arquivos enviados, as miniaturas e os PDFs gerados. */
export const DELETE = route(async (_req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const batch = await loadBatch(s.org.id, id);
  if (batch.status === "GENERATING") throw new ApiError(409, "Aguarde a geração terminar para excluir.");
  const jobs = await db.job.findMany({ where: { batchId: id, outputKey: { not: null } }, select: { outputKey: true } });
  await storage().deletePrefix(keys.batchPrefix(s.org.id, id));
  for (const j of jobs) await storage().delete(j.outputKey!);
  await db.batch.delete({ where: { id } });
  await audit(s.org.id, s.user.id, "batch.deleted", id);
  return json({ ok: true });
});
