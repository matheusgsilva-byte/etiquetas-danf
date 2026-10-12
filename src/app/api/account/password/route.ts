import { z } from "zod";
import { ApiError, json, parseBody, requireSession, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/crypto";
import { db } from "@/lib/db";

const schema = z.object({ current: z.string().min(1, "Informe a senha atual."), next: z.string() });

export const POST = route(async (req) => {
  const s = await requireSession();
  const body = await parseBody(req, schema);
  const user = await db.user.findUniqueOrThrow({ where: { id: s.user.id } });
  if (!(await verifyPassword(body.current, user.passwordHash))) throw new ApiError(400, "A senha atual está incorreta.");
  const problem = passwordProblem(body.next);
  if (problem) throw new ApiError(400, problem);
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } }),
    // Mantém apenas a sessão atual.
    db.session.deleteMany({ where: { userId: user.id, id: { not: s.sessionId } } }),
  ]);
  await audit(s.org.id, user.id, "account.password_changed", user.id);
  return json({ ok: true });
});
