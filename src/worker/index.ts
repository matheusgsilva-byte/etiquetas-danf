/**
 * Worker de processamento (processo separado do servidor web).
 *   npm run worker
 */
import { Worker, type Job } from "bullmq";
import { env } from "../lib/env";
import { maintenanceQueue, QUEUES, redisConnection, type AnalyzeJobData, type GenerateJobData } from "../lib/queue";
import { processAnalyze } from "./jobs/analyze";
import { processGenerate } from "./jobs/generate";
import { runMaintenance } from "./jobs/maintenance";

const config = env();
const connection = redisConnection();

const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const workers = [
  new Worker<AnalyzeJobData>(QUEUES.analyze, async (job) => processAnalyze(job.data.fileId, isFinal(job)), {
    connection,
    concurrency: config.WORKER_CONCURRENCY,
  }),
  new Worker<GenerateJobData>(QUEUES.generate, async (job) => processGenerate(job.data.jobId, isFinal(job)), {
    connection,
    concurrency: config.WORKER_CONCURRENCY,
    lockDuration: 120_000,
  }),
  new Worker(
    QUEUES.maintenance,
    async () => {
      const stats = await runMaintenance();
      console.info("[maintenance]", JSON.stringify(stats));
    },
    { connection, concurrency: 1 },
  ),
];

for (const w of workers) {
  w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} falhou (tentativa ${job?.attemptsMade}):`, err.message));
  w.on("error", (err) => console.error(`[${w.name}]`, err.message));
}

maintenanceQueue()
  .upsertJobScheduler("retention-cleanup", { every: 15 * 60_000 }, { name: "cleanup" })
  .catch((err) => console.error("[worker] não foi possível agendar a limpeza:", err.message));

console.info(`[worker] LabelHub worker iniciado (concorrência ${config.WORKER_CONCURRENCY}, armazenamento ${config.STORAGE_DRIVER}).`);

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} recebido, finalizando jobs em andamento...`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
