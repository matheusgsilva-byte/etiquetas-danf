import { z } from "zod";
import { ApiError, json, parseBody, requireRole, requireSession, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/auth/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";

export const GET = route(async () => {
  const s = await requireSession();
  const [members, invites] = await Promise.all([
    db.membership.findMany({
      where: { orgId: s.org.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invite.findMany({
      where: { orgId: s.org.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
  ]);
  return json({
    members: members.map((m) => ({ id: m.id, role: m.role, createdAt: m.createdAt, user: m.user, isYou: m.userId === s.user.id })),
    invites,
  });
});

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export const POST = route(async (req) => {
  const s = await requireSession();
  requireRole(s, ["OWNER", "ADMIN"]);
  const body = await parseBody(req, inviteSchema);
  const already = await db.membership.findFirst({ where: { orgId: s.org.id, user: { email: body.email } } });
  if (already) throw new ApiError(409, "Esta pessoa já faz parte da equipe.");

  const token = randomToken();
  await db.invite.create({
    data: {
      orgId: s.org.id,
      email: body.email,
      role: body.role,
      tokenHash: sha256(token),
      invitedById: s.user.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });
  const link = `${env().APP_URL.replace(/\/$/, "")}/convite?token=${token}`;
  await sendMail(
    body.email,
    `Convite para a equipe ${s.org.name} — LabelHub Cloud`,
    `${s.user.name} convidou você para unificar etiquetas com a equipe ${s.org.name} no LabelHub Cloud.\n\nAceite o convite (válido por 7 dias):\n${link}`,
  );
  await audit(s.org.id, s.user.id, "member.invited", null, { role: body.role });
  // O link também é devolvido para que o administrador possa compartilhá-lo diretamente.
  return json({ ok: true, link });
});
