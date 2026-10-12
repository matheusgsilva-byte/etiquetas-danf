import { db } from "@/lib/db";
import { redisConnection } from "@/lib/queue";

export const dynamic = "force-dynamic";

/** Verificação de saúde para o balanceador / orquestrador. */
export async function GET() {
  const checks: Record<string, "ok" | "falha"> = { database: "falha", redis: "falha" };
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {}
  try {
    await redisConnection().ping();
    checks.redis = "ok";
  } catch {}
  const ok = Object.values(checks).every((v) => v === "ok");
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
