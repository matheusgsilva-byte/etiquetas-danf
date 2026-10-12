import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Regras mínimas de senha. Retorna mensagem de erro ou null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "A senha deve ter pelo menos 8 caracteres.";
  if (password.length > 128) return "A senha deve ter no máximo 128 caracteres.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use letras e números na senha.";
  return null;
}
