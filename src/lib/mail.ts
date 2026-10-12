/**
 * Envio de e-mails transacionais (recuperação de senha e convites).
 * Sem SMTP_URL configurado, o conteúdo é registrado no log do servidor —
 * útil em desenvolvimento.
 */
import nodemailer from "nodemailer";
import { env } from "./env";

export async function sendMail(to: string, subject: string, text: string) {
  const { SMTP_URL, MAIL_FROM } = env();
  if (!SMTP_URL) {
    console.info(`[mail] SMTP não configurado. E-mail para ${to}\nAssunto: ${subject}\n${text}`);
    return;
  }
  const transport = nodemailer.createTransport(SMTP_URL);
  await transport.sendMail({ from: MAIL_FROM, to, subject, text });
}
