/**
 * Filas de processamento assíncrono (BullMQ + Redis).
 *  - analyze:     análise de cada PDF enviado
 *  - generate:    geração do PDF unificado
 *  - maintenance: limpeza periódica por política de retenção
 */
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export const QUEUES = {
  analyze: "labelhub-analyze",
  generate: "labelhub-generate",
  maintenance: "labelhub-maintenance",
} as const;

export interface AnalyzeJobData {
  fileId: string;
}
export interface GenerateJobData {
  jobId: string;
}

type Globals = {
  redis?: IORedis;
  queues?: Partial<Record<keyof typeof QUEUES, Queue>>;
};
const g = globalThis as unknown as Globals;

export function redisConnection(): IORedis {
  if (!g.redis) {
    g.redis = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  }
  return g.redis;
}

function queue(name: keyof typeof QUEUES): Queue {
  g.queues ??= {};
  if (!g.queues[name]) {
    g.queues[name] = new Queue(QUEUES[name], {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { age: 24 * 3600, count: 5000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return g.queues[name]!;
}

export async function enqueueAnalyze(fileId: string) {
  await queue("analyze").add("analyze", { fileId } satisfies AnalyzeJobData, { jobId: `analyze-${fileId}-${Date.now()}` });
}

export async function enqueueGenerate(jobId: string) {
  await queue("generate").add("generate", { jobId } satisfies GenerateJobData, { jobId: `generate-${jobId}-${Date.now()}`, attempts: 2 });
}

export function maintenanceQueue() {
  return queue("maintenance");
}
