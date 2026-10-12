import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { randomToken, sha256 } from "@/lib/auth/crypto";
import { clientInfo } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido.") });

export const POST = route(async (req) => {
  const { ip } = await clientInfo();
  const { email } = await parseBody(req, schema);
  await rateLimit(`forgot:${ip ?? "?"}`, 10, 3600);
  await rateLimit(`forgot:${email}`, 3, 3600);

  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = randomToken();
    await db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) },
    });
    const link = `${env().APP_URL.replace(/\/$/, "")}/redefinir-senha?token=${token}`;
    await sendMail(
      email,
      "Redefinição de senha — LabelHub Cloud",
      `Olá, ${user.name}.\n\nRecebemos um pedido para redefinir sua senha. Use o link abaixo (válido por 1 hora):\n\n${link}\n\nSe você não fez este pedido, ignore este e-mail.`,
    );
  }
  // Mesma resposta exista ou não a conta (evita descobrir e-mails cadastrados).
  return json({ ok: true });
});
