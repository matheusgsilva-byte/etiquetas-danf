/**
 * Job de análise de um arquivo enviado.
 */
import { db } from "../../lib/db";
import { analyzePdf } from "../../lib/pdf/analyze";
import { PdfInputError } from "../../lib/pdf/load";
import { shipmentKey } from "../../lib/marketplaces";
import { planLimits } from "../../lib/plans";
import { keys, storage } from "../../lib/storage";
import { recomputeDuplicates, refreshBatchStatus } from "../../lib/batch-service";

const POSITION_STRIDE = 10_000;

async function fail(fileId: string, batchId: string, message: string) {
  await db.sourceFile.update({ where: { id: fileId }, data: { status: "ERROR", error: message, analyzedAt: new Date() } });
  await db.label.deleteMany({ where: { fileId } });
  await recomputeDuplicates(batchId);
  await refreshBatchStatus(batchId);
}

export async function processAnalyze(fileId: string, isFinalAttempt: boolean) {
  const file = await db.sourceFile.findUnique({
    where: { id: fileId },
    include: { batch: { include: { org: true } } },
  });
  if (!file || file.purgedAt || file.status === "READY" || file.status === "ERROR") return;
  const { batch } = file;
  const org = batch.org;

  await db.sourceFile.update({ where: { id: fileId }, data: { status: "ANALYZING", error: null } });

  let bytes: Buffer;
  try {
    bytes = await storage().get(file.storageKey);
  } catch (err) {
    if (!isFinalAttempt) {
      await db.sourceFile.update({ where: { id: fileId }, data: { status: "PENDING" } });
      throw err;
    }
    await fail(fileId, batch.id, "Não foi possível ler o arquivo armazenado. Envie-o novamente.");
    return;
  }

  let analysis;
  try {
    analysis = await analyzePdf(new Uint8Array(bytes), file.originalName);
  } catch (err) {
    if (err instanceof PdfInputError) {
      await fail(fileId, batch.id, err.message);
      return;
    }
    if (!isFinalAttempt) {
      await db.sourceFile.update({ where: { id: fileId }, data: { status: "PENDING" } });
      throw err;
    }
    console.error("[analyze] falha", fileId, err);
    await fail(fileId, batch.id, "Não foi possível analisar este PDF. Verifique se ele abre normalmente e envie de novo.");
    return;
  }

  // Limite de páginas por lote do plano.
  const limits = planLimits(org.plan);
  const pagesSoFar = await db.sourceFile.aggregate({
    where: { batchId: batch.id, status: "READY", id: { not: fileId } },
    _sum: { pageCount: true },
  });
  if ((pagesSoFar._sum.pageCount ?? 0) + analysis.pageCount > limits.maxPagesPerBatch) {
    await fail(
      fileId,
      batch.id,
      `Este arquivo ultrapassa o limite de ${limits.maxPagesPerBatch} páginas por lote do plano ${limits.name}.`,
    );
    return;
  }

  // Arquivo reparado/desprotegido pelo qpdf: guarda a versão normalizada para a unificação.
  if (analysis.normalizedBytes) {
    await storage().put(file.storageKey, analysis.normalizedBytes, "application/pdf");
  }

  // Miniaturas.
  const thumbKeys = new Map<number, string>();
  for (const page of analysis.pages) {
    if (!page.thumbnail) continue;
    const key = keys.thumbnail(org.id, batch.id, file.id, page.index);
    await storage().put(key, page.thumbnail, "image/jpeg");
    thumbKeys.set(page.index, key);
  }

  await db.$transaction([
    db.label.deleteMany({ where: { fileId } }),
    db.label.createMany({
      data: analysis.pages.map((p) => ({
        batchId: batch.id,
        fileId: file.id,
        pageIndex: p.index,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
        rotation: p.rotation,
        cropBox: { ...p.cropBox },
        contentBox: p.contentBox ? { ...p.contentBox } : undefined,
        marketplace: p.marketplace,
        confidence: p.confidence,
        orderId: p.orderId,
        trackingCode: p.trackingCode,
        shipmentKey: shipmentKey(p.marketplace, p),
        fingerprint: p.fingerprint,
        thumbnailKey: thumbKeys.get(p.index) ?? null,
        blank: p.blank,
        position: file.uploadIndex * POSITION_STRIDE + p.index,
      })),
    }),
    db.sourceFile.update({
      where: { id: fileId },
      data: {
        status: "READY",
        pageCount: analysis.pageCount,
        marketplace: analysis.marketplace,
        repaired: analysis.repaired,
        analyzedAt: new Date(),
        error: null,
      },
    }),
  ]);

  await recomputeDuplicates(batch.id);
  await refreshBatchStatus(batch.id);
}
