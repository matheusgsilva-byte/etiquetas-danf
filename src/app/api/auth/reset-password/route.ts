import { z } from "zod";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { hashPassword, passwordProblem, sha256 } from "@/lib/auth/crypto";
import { db } from "@/lib/db";

const schema = z.object({ token: z.string().min(10), password: z.string() });

export const POST = route(async (req) => {
  const { token, password } = await parseBody(req, schema);
  const problem = passwordProblem(password);
  if (problem) throw new ApiError(400, problem);

  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new ApiError(400, "Link inválido ou expirado. Solicite uma nova redefinição.");
  }
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Encerra todas as sessões abertas após a troca de senha.
    db.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  return json({ ok: true });
});
