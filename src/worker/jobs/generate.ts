/**
 * Job de geração do PDF unificado.
 *
 * O resultado só é marcado como concluído depois de: (1) o PDF ser montado,
 * (2) cada bloco reaberto e validado (nº e tamanho de páginas), (3) os blocos
 * juntados e o total de páginas conferido e (4) o arquivo gravado e conferido
 * no armazenamento. Em caso de falha nada é publicado e o lote volta a ficar
 * disponível para nova tentativa.
 */
import type { PDFDocument } from "pdf-lib";
import { audit } from "../../lib/audit";
import { db } from "../../lib/db";
import { groupByMarketplace, sortLabels } from "../../lib/labels";
import { marketplaceName } from "../../lib/marketplaces";
import { normalizeSettings } from "../../lib/output-settings";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { composeToFile } from "../../lib/pdf/chunked";
import type { ComposeEntry, LabelEntry } from "../../lib/pdf/compose";
import type { Box } from "../../lib/pdf/layout";
import { loadPdfForProcessing } from "../../lib/pdf/load";
import { keys, storage } from "../../lib/storage";

function outputFileName(date: Date, labels: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Data no fuso de São Paulo para o nome do arquivo.
  const local = new Date(date.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const stamp = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}_${pad(local.getHours())}h${pad(local.getMinutes())}`;
  return `etiquetas_${stamp}_${labels}un.pdf`;
}

export async function processGenerate(jobId: string, isFinalAttempt: boolean) {
  const job = await db.job.findUnique({ where: { id: jobId }, include: { batch: true, org: true } });
  if (!job || job.status === "COMPLETED") return;
  const started = Date.now();
  const settings = normalizeSettings(job.settings);
  let outputKey: string | null = null;
  let tempDir: string | null = null;
  let sourceDir: string | null = null;

  const setStage = (stage: string, progress: number) =>
    db.job.update({ where: { id: jobId }, data: { stage, progress: Math.min(99, Math.round(progress)) } });

  try {
    await db.job.update({
      where: { id: jobId },
      data: { status: "PROCESSING", startedAt: new Date(), stage: "Preparando etiquetas", progress: 1, error: null },
    });

    const labels = await db.label.findMany({
      where: { batchId: job.batchId, file: { status: "READY", purgedAt: null } },
      include: { file: { select: { id: true, originalName: true, uploadIndex: true, storageKey: true, createdAt: true } } },
    });
    const included = labels.filter((l) => !l.excluded);
    const discarded = labels.length - included.length;
    if (included.length === 0) throw new Error("Nenhuma etiqueta selecionada para gerar o PDF.");

    const ordered = sortLabels(
      included.map((l) => ({
        ...l,
        fileName: l.file.originalName,
        uploadIndex: l.file.uploadIndex,
        importedAt: l.file.createdAt,
      })),
      "CUSTOM",
    );

    const toEntry = (l: (typeof ordered)[number]): LabelEntry => ({
      kind: "label",
      ref: `${l.file.originalName} (pág. ${l.pageIndex + 1})`,
      sourceId: l.fileId,
      pageIndex: l.pageIndex,
      cropBox: l.cropBox as unknown as Box,
      contentBox: (l.contentBox as unknown as Box | null) ?? null,
      rotation: l.rotation,
    });

    let entries: ComposeEntry[];
    if (settings.groupByMarketplace) {
      entries = groupByMarketplace(ordered).flatMap((g) => [
        ...(settings.separatorPages
          ? [{ kind: "separator" as const, title: marketplaceName(g.marketplace), subtitle: `${g.items.length} etiqueta(s)` }]
          : []),
        ...g.items.map(toEntry),
      ]);
    } else {
      entries = ordered.map(toEntry);
    }

    const storageKeys = new Map(included.map((l) => [l.fileId, l.file.storageKey]));
    // Cada PDF de origem é baixado uma única vez para o disco; depois é reaberto
    // de lá quando um bloco precisar dele (sem manter todos na memória).
    sourceDir = await mkdtemp(path.join(os.tmpdir(), "labelhub-src-"));
    const localFiles = new Map<string, string>();
    const loadSource = async (fileId: string): Promise<PDFDocument> => {
      let local = localFiles.get(fileId);
      if (!local) {
        const key = storageKeys.get(fileId);
        if (!key) throw new Error("Arquivo de origem não encontrado.");
        local = path.join(sourceDir!, `${fileId}.pdf`);
        await writeFile(local, await storage().get(key));
        localFiles.set(fileId, local);
      }
      const { doc } = await loadPdfForProcessing(new Uint8Array(await readFile(local)));
      return doc;
    };

    await setStage("Unificando etiquetas", 5);
    let lastPct = -1;
    const result = await composeToFile(entries, {
      settings,
      loadSource,
      title: job.batch.name,
      onProgress: async (done, total) => {
        const pct = Math.floor((done / total) * 80);
        if (pct === lastPct) return;
        lastPct = pct;
        await setStage(`Unificando etiquetas (${done}/${total})`, 5 + pct);
      },
    });
    tempDir = result.dir;

    await setStage("Salvando arquivo", 92);
    outputKey = keys.output(job.orgId, job.id);
    await storage().putFile(outputKey, result.file, "application/pdf");
    const stored = await storage().head(outputKey);
    if (!stored || stored.size !== result.size) {
      throw new Error("O arquivo gerado não foi gravado corretamente no armazenamento.");
    }

    const marketplaceCounts: Record<string, number> = {};
    for (const l of included) marketplaceCounts[l.marketplace] = (marketplaceCounts[l.marketplace] ?? 0) + 1;
    const finishedAt = new Date();

    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          progress: 100,
          stage: "Concluído",
          outputKey,
          outputName: outputFileName(finishedAt, result.labelCount),
          outputSize: result.size,
          pageCount: result.pageCount,
          filesCount: new Set(included.map((l) => l.fileId)).size,
          labelsIncluded: result.labelCount,
          labelsDiscarded: discarded,
          marketplaceCounts,
          warnings: result.warnings.map((w) => ({ ...w })),
          durationMs: Date.now() - started,
          finishedAt,
          expiresAt: new Date(finishedAt.getTime() + job.org.retentionDays * 86_400_000),
        },
      }),
      db.batch.update({ where: { id: job.batchId }, data: { status: "COMPLETED" } }),
    ]);

    await audit(job.orgId, job.createdById, "job.completed", job.id, {
      labels: result.labelCount,
      pages: result.pageCount,
    });

    if (job.org.deleteSourcesAfterGeneration) {
      await storage().deletePrefix(keys.batchPrefix(job.orgId, job.batchId));
      await db.sourceFile.updateMany({ where: { batchId: job.batchId }, data: { purgedAt: new Date() } });
      await db.label.updateMany({ where: { batchId: job.batchId }, data: { thumbnailKey: null } });
    }
  } catch (err) {
    if (outputKey) await storage().delete(outputKey).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate] falha", jobId, err);
    if (!isFinalAttempt) {
      await db.job.update({ where: { id: jobId }, data: { status: "QUEUED", stage: "Nova tentativa em instantes", progress: 0 } });
      throw err;
    }
    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          stage: "Falhou",
          error: `Não foi possível gerar o PDF: ${message}`,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
        },
      }),
      db.batch.update({ where: { id: job.batchId }, data: { status: "READY" } }),
    ]);
    await audit(job.orgId, job.createdById, "job.failed", job.id, { error: message.slice(0, 300) });
  } finally {
    for (const d of [tempDir, sourceDir]) if (d) await rm(d, { recursive: true, force: true }).catch(() => undefined);
  }
}
