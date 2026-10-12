import type { Prisma } from "@prisma/client";
import { db } from "./db";

/** Registro de auditoria (quem fez o quê) — boa prática de LGPD. Nunca grava conteúdo das etiquetas. */
export async function audit(
  orgId: string,
  userId: string | null,
  action: string,
  targetId?: string | null,
  meta?: Prisma.InputJsonValue,
  ip?: string | null,
) {
  try {
    await db.auditLog.create({ data: { orgId, userId, action, targetId: targetId ?? null, meta, ip: ip ?? null } });
  } catch (err) {
    console.warn("[audit] falha ao registrar", action, (err as Error).message);
  }
}
