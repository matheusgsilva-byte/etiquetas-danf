import { z } from "zod";
import { ApiError, json, parseBody, requireSession, route, type IdParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { normalizeSettings } from "@/lib/output-settings";

const schema = z.object({
  /** Nova ordem completa (ids das etiquetas). */
  order: z.array(z.string()).max(20_000).optional(),
  sort: z.enum(["CUSTOM", "UPLOAD", "MARKETPLACE", "FILENAME", "ORDER_ID", "SKU", "DESCRIPTION", "IMPORTED_AT"]).optional(),
  changes: z
    .array(
      z.object({
        id: z.string(),
        excluded: z.boolean().optional(),
        decision: z.enum(["KEEP", "REMOVE"]).optional(),
      }),
    )
    .max(20_000)
    .optional(),
  bulk: z.enum(["REMOVE_PENDING_DUPLICATES", "KEEP_PENDING_DUPLICATES"]).optional(),
});

export const PATCH = route(async (req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const batch = await db.batch.findFirst({ where: { id, orgId: s.org.id } });
  if (!batch) throw new ApiError(404, "Unificação não encontrada.");
  if (batch.status === "GENERATING") throw new ApiError(409, "Aguarde a geração do PDF terminar.");
  const body = await parseBody(req, schema);

  const labels = await db.label.findMany({
    where: { batchId: id },
    select: { id: true, duplicateType: true, duplicateDecision: true },
  });
  const byId = new Map(labels.map((l) => [l.id, l]));

  await db.$transaction(async (tx) => {
    if (body.order) {
      const unique = new Set(body.order);
      if (unique.size !== body.order.length || body.order.some((lid) => !byId.has(lid))) {
        throw new ApiError(400, "A ordem enviada não corresponde às etiquetas do lote. Atualize a página.");
      }
      // Etiquetas não citadas (ex.: chegaram durante a edição) vão para o fim.
      const rest = labels.filter((l) => !unique.has(l.id)).map((l) => l.id);
      const full = [...body.order, ...rest];
      const values = full.map((lid, i) => `('${lid.replace(/'/g, "")}', ${i})`).join(",");
      await tx.$executeRawUnsafe(
        `UPDATE "Label" AS l SET "position" = v.pos FROM (VALUES ${values}) AS v(id, pos) WHERE l."id" = v.id AND l."batchId" = $1`,
        id,
      );
    }

    for (const c of body.changes ?? []) {
      const label = byId.get(c.id);
      if (!label) continue;
      let excluded = c.excluded;
      let decision = label.duplicateDecision;
      if (c.decision) {
        decision = c.decision;
        excluded = c.decision === "REMOVE";
      } else if (excluded !== undefined && label.duplicateType) {
        decision = excluded ? "REMOVE" : "KEEP";
      }
      await tx.label.update({ where: { id: c.id }, data: { excluded, duplicateDecision: label.duplicateType ? decision : null } });
    }

    if (body.bulk === "REMOVE_PENDING_DUPLICATES") {
      await tx.label.updateMany({
        where: { batchId: id, duplicateType: { not: null }, duplicateDecision: "PENDING" },
        data: { duplicateDecision: "REMOVE", excluded: true },
      });
    } else if (body.bulk === "KEEP_PENDING_DUPLICATES") {
      await tx.label.updateMany({
        where: { batchId: id, duplicateType: { not: null }, duplicateDecision: "PENDING" },
        data: { duplicateDecision: "KEEP", excluded: false },
      });
    }

    if (body.sort) {
      await tx.batch.update({
        where: { id },
        data: { settings: normalizeSettings({ ...normalizeSettings(batch.settings), sort: body.sort }) },
      });
    }
  });

  if (body.bulk) await audit(s.org.id, s.user.id, `duplicates.${body.bulk.toLowerCase()}`, id);
  return json({ ok: true });
});
