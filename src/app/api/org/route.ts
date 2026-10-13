import { z } from "zod";
import { ApiError, json, parseBody, requireRole, requireSession, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { destroySession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { outputSettingsSchema, normalizeSettings } from "@/lib/output-settings";
import { LIMITS } from "@/lib/plans";
import { keys, storage } from "@/lib/storage";

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  deleteSourcesAfterGeneration: z.boolean().optional(),
  defaultSettings: outputSettingsSchema.partial().optional(),
});

export const PATCH = route(async (req) => {
  const s = await requireSession();
  requireRole(s, ["OWNER", "ADMIN"]);
  const body = await parseBody(req, schema);
  if (body.retentionDays && body.retentionDays > LIMITS.maxRetentionDays) {
    throw new ApiError(400, `O prazo máximo de retenção é ${LIMITS.maxRetentionDays} dias.`);
  }
  await db.organization.update({
    where: { id: s.org.id },
    data: {
      name: body.name,
      retentionDays: body.retentionDays,
      deleteSourcesAfterGeneration: body.deleteSourcesAfterGeneration,
      defaultSettings: body.defaultSettings
        ? normalizeSettings({ ...normalizeSettings(s.org.defaultSettings), ...body.defaultSettings })
        : undefined,
    },
  });
  // Novo prazo de retenção vale também para os PDFs já gerados.
  if (body.retentionDays) {
    await db.$executeRaw`
      UPDATE "Job" SET "expiresAt" = "finishedAt" + (${body.retentionDays} * INTERVAL '1 day')
      WHERE "orgId" = ${s.org.id} AND "status" = 'COMPLETED' AND "finishedAt" IS NOT NULL`;
  }
  await audit(s.org.id, s.user.id, "org.updated", s.org.id, { fields: Object.keys(body) });
  return json({ ok: true });
});

/**
 * Exclui a empresa e TODOS os dados dela (arquivos, PDFs, histórico, membros).
 * Direito de eliminação (LGPD). Somente o proprietário pode executar.
 */
export const DELETE = route(async (req) => {
  const s = await requireSession();
  requireRole(s, ["OWNER"]);
  const { confirm } = await parseBody(req, z.object({ confirm: z.string() }));
  if (confirm.trim() !== s.org.name.trim()) throw new ApiError(400, "Digite o nome exato da empresa para confirmar.");

  await storage().deletePrefix(keys.orgPrefix(s.org.id));
  const members = await db.membership.findMany({ where: { orgId: s.org.id }, select: { userId: true } });
  await db.organization.delete({ where: { id: s.org.id } });
  // Remove usuários que ficaram sem nenhuma empresa.
  for (const m of members) {
    const others = await db.membership.count({ where: { userId: m.userId } });
    if (others === 0) await db.user.delete({ where: { id: m.userId } }).catch(() => undefined);
  }
  await destroySession();
  return json({ ok: true });
});
