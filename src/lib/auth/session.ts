/**
 * Sessões em banco com cookie httpOnly. O cookie guarda um token aleatório;
 * no banco fica apenas o hash SHA-256 dele.
 */
import { cookies, headers } from "next/headers";
import type { MemberRole, Organization, User } from "@prisma/client";
import { db } from "../db";
import { env, isProduction } from "../env";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "lh_session";

export interface SessionContext {
  sessionId: string;
  user: Pick<User, "id" | "email" | "name">;
  org: Organization;
  role: MemberRole;
}

export async function clientInfo() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export async function createSession(userId: string, orgId: string) {
  const token = randomToken();
  const ttlDays = env().SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  const info = await clientInfo();
  await db.session.create({
    data: { tokenHash: sha256(token), userId, orgId, expiresAt, ip: info.ip, userAgent: info.userAgent },
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true } }, org: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId: session.userId, orgId: session.orgId } },
  });
  if (!membership) return null;
  // Atualiza "visto por último" no máximo a cada 10 minutos.
  if (Date.now() - session.lastSeenAt.getTime() > 600_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return { sessionId: session.id, user: session.user, org: session.org, role: membership.role };
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  store.delete(SESSION_COOKIE);
}
