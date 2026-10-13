import { z } from "zod";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem, sha256, verifyPassword } from "@/lib/auth/crypto";
import { createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  token: z.string().min(10),
  name: z.string().trim().max(100).optional(),
  password: z.string(),
});

/** Aceita um convite: cria a conta (se ainda não existir) ou vincula a conta existente. */
export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const invite = await db.invite.findUnique({ where: { tokenHash: sha256(body.token) }, include: { org: true } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new ApiError(400, "Convite inválido ou expirado. Peça um novo convite ao administrador.");
  }

  let user = await db.user.findUnique({ where: { email: invite.email } });
  if (user) {
    if (!(await verifyPassword(body.password, user.passwordHash))) throw new ApiError(401, "Senha incorreta para esta conta.");
  } else {
    const problem = passwordProblem(body.password);
    if (problem) throw new ApiError(400, problem);
    if (!body.name || body.name.length < 2) throw new ApiError(400, "Informe seu nome.");
    user = await db.user.create({
      data: { email: invite.email, name: body.name, passwordHash: await hashPassword(body.password) },
    });
  }

  await db.$transaction([
    db.membership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: invite.orgId } },
      create: { userId: user.id, orgId: invite.orgId, role: invite.role },
      update: {},
    }),
    db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);
  await createSession(user.id, invite.orgId);
  await audit(invite.orgId, user.id, "member.joined", user.id);
  return json({ ok: true });
});

/** Dados públicos do convite (para exibir na tela de aceite). */
export const GET = route(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const invite = await db.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { org: { select: { name: true } } } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new ApiError(404, "Convite inválido ou expirado.");
  const hasAccount = !!(await db.user.findUnique({ where: { email: invite.email }, select: { id: true } }));
  return json({ email: invite.email, company: invite.org.name, hasAccount });
});
