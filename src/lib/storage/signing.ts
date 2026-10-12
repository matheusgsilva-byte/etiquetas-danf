/**
 * Assinatura HMAC dos links temporários do armazenamento local.
 * (No S3 os links são pré-assinados pela própria AWS.)
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface DownloadToken {
  key: string;
  exp: number; // epoch em segundos
  fn?: string;
  inline?: boolean;
  ct?: string;
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encodeDownloadToken(token: DownloadToken, secret: string) {
  const payload = Buffer.from(JSON.stringify(token)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeDownloadToken(value: string, secret: string): DownloadToken | null {
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const token = JSON.parse(Buffer.from(payload, "base64url").toString()) as DownloadToken;
    if (typeof token.key !== "string" || typeof token.exp !== "number") return null;
    if (token.exp < Math.floor(Date.now() / 1000)) return null;
    return token;
  } catch {
    return null;
  }
}

/** Nome de arquivo seguro para o cabeçalho Content-Disposition. */
export function contentDisposition(filename: string, inline = false) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
