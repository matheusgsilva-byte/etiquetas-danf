import { db } from "@/lib/db";
import { redisConnection } from "@/lib/queue";
import { storage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

/**
 * Verificação de saúde para o balanceador / orquestrador.
 * O armazenamento é informativo (não derruba o "ok"), para que um problema de
 * credenciais do bucket apareça aqui sem impedir a publicação de correções.
 */
export async function GET() {
  const checks: Record<string, string> = { database: "falha", redis: "falha" };
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {}
  try {
    await redisConnection().ping();
    checks.redis = "ok";
  } catch {}
  const ok = checks.database === "ok" && checks.redis === "ok";
  try {
    // Chave inexistente: 404 (null) prova que as credenciais são aceitas.
    await withTimeout(storage().head("health/inexistente.txt"), 5000);
    checks.storage = "ok";
  } catch (err) {
    const e = err as { name?: string; Code?: string; message?: string };
    checks.storage = `falha: ${(e.name || e.Code || e.message || "erro").slice(0, 60)}`;
  }
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
