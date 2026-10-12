import { z } from "zod";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/auth/crypto";
import { clientInfo, createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha."),
});

// Hash fictício para manter o tempo de resposta igual quando o e-mail não existe.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("labelhub-dummy-password-1"));

export const POST = route(async (req) => {
  const { ip } = await clientInfo();
  const body = await parseBody(req, schema);
  await rateLimit(`login:ip:${ip ?? "?"}`, 30, 900);
  await rateLimit(`login:email:${body.email}`, 10, 900);

  const user = await db.user.findUnique({
    where: { email: body.email },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const valid = await verifyPassword(body.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) throw new ApiError(401, "E-mail ou senha incorretos.");
  const membership = user.memberships[0];
  if (!membership) throw new ApiError(403, "Sua conta não está vinculada a nenhuma empresa.");

  await createSession(user.id, membership.orgId);
  await audit(membership.orgId, user.id, "auth.login", user.id, undefined, ip);
  return json({ ok: true });
});
