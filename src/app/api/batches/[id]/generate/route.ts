import { z } from "zod";
import { ApiError, json, parseBody, requireSession, route, type IdParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { normalizeSettings, outputSettingsSchema } from "@/lib/output-settings";
import { enqueueGenerate } from "@/lib/queue";
import { serializeJob } from "@/lib/serializers";

const schema = z.object({
  settings: outputSettingsSchema.partial().optional(),
  /** O usuário confirmou manter as duplicidades ainda não revisadas. */
  confirmDuplicates: z.boolean().optional(),
});

export const POST = route(async (req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const body = await parseBody(req, schema);
  const batch = await db.batch.findFirst({ where: { id, orgId: s.org.id } });
  if (!batch) throw new ApiError(404, "Unificação não encontrada.");
  if (batch.status === "GENERATING") throw new ApiError(409, "Este PDF já está sendo gerado.");

  const analyzing = await db.sourceFile.count({ where: { batchId: id, status: { in: ["PENDING", "ANALYZING"] } } });
  if (analyzing) throw new ApiError(409, "Aguarde a análise de todos os arquivos terminar.", "ANALYZING");

  const purged = await db.sourceFile.count({ where: { batchId: id, status: "READY", purgedAt: { not: null } } });
  if (purged) throw new ApiError(410, "Os arquivos de origem deste lote já foram excluídos pela política de retenção.");

  const baseWhere = { batchId: id, file: { status: "READY" as const } };
  const pendingDuplicates = await db.label.count({
    where: { ...baseWhere, duplicateType: { not: null }, duplicateDecision: "PENDING" },
  });
  if (pendingDuplicates && !body.confirmDuplicates) {
    throw new ApiError(
      409,
      `Há ${pendingDuplicates} possível(is) duplicidade(s) sem revisão. Revise ou confirme para manter todas.`,
      "DUPLICATES_PENDING",
    );
  }

  const settings = normalizeSettings({ ...normalizeSettings(batch.settings), ...(body.settings ?? {}) });
  const included = await db.label.count({ where: { ...baseWhere, excluded: false } });
  if (!included) throw new ApiError(400, "Nenhuma etiqueta selecionada para gerar o PDF.");

  const job = await db.$transaction(async (tx) => {
    if (pendingDuplicates) {
      await tx.label.updateMany({
        where: { batchId: id, duplicateType: { not: null }, duplicateDecision: "PENDING" },
        data: { duplicateDecision: "KEEP" },
      });
    }
    await tx.batch.update({ where: { id }, data: { settings, status: "GENERATING" } });
    return tx.job.create({
      data: { orgId: s.org.id, batchId: id, createdById: s.user.id, settings, stage: "Na fila" },
    });
  });

  try {
    await enqueueGenerate(job.id);
  } catch (err) {
    console.error("[generate] fila indisponível", err);
    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        data: { status: "FAILED", error: "Serviço de processamento indisponível. Tente novamente.", finishedAt: new Date() },
      }),
      db.batch.update({ where: { id }, data: { status: "READY" } }),
    ]);
    throw new ApiError(503, "Serviço de processamento indisponível. Tente novamente em instantes.");
  }

  await audit(s.org.id, s.user.id, "job.requested", job.id, { labels: included });
  return json({ job: serializeJob(job) }, { status: 202 });
});
