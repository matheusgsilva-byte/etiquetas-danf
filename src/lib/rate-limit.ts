import { ApiError } from "./api";
import { redisConnection } from "./queue";

/**
 * Limite simples por janela fixa usando Redis. Ex.: 10 tentativas de login por
 * IP a cada 15 minutos.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  try {
    const redis = redisConnection();
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSeconds);
    if (count > limit) {
      throw new ApiError(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.", "RATE_LIMITED");
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Se o Redis estiver indisponível, não bloqueia o usuário (falha aberta e registra).
    console.warn("[rate-limit] indisponível:", (err as Error).message);
  }
}
