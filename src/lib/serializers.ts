/**
 * Formatos de resposta da API (o que a interface recebe).
 */
import type { Batch, Job, Label, SourceFile } from "@prisma/client";
import { normalizeSettings } from "./output-settings";

export function serializeJob(job: Job) {
  return {
    id: job.id,
    batchId: job.batchId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    outputName: job.outputName,
    outputSize: job.outputSize,
    pageCount: job.pageCount,
    filesCount: job.filesCount,
    labelsIncluded: job.labelsIncluded,
    labelsDiscarded: job.labelsDiscarded,
    marketplaceCounts: (job.marketplaceCounts as Record<string, number> | null) ?? {},
    warnings: (job.warnings as { ref: string; message: string }[] | null) ?? [],
    settings: normalizeSettings(job.settings),
    durationMs: job.durationMs,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    expiresAt: job.expiresAt,
    downloadable: job.status === "COMPLETED" && !!job.outputKey && !job.deletedAt,
  };
}

export type JobDto = ReturnType<typeof serializeJob>;

export function serializeFile(f: SourceFile) {
  return {
    id: f.id,
    name: f.originalName,
    sizeBytes: f.sizeBytes,
    pageCount: f.pageCount,
    status: f.status,
    error: f.error,
    marketplace: f.marketplace,
    uploadIndex: f.uploadIndex,
    repaired: f.repaired,
    duplicateOfFileId: f.duplicateOfFileId,
    purged: !!f.purgedAt,
    createdAt: f.createdAt,
  };
}

export type FileDto = ReturnType<typeof serializeFile>;

export function serializeLabel(l: Label, file: SourceFile) {
  return {
    id: l.id,
    fileId: l.fileId,
    fileName: file.originalName,
    uploadIndex: file.uploadIndex,
    importedAt: file.createdAt,
    pageIndex: l.pageIndex,
    widthMm: Math.round((l.widthPt * 25.4) / 72),
    heightMm: Math.round((l.heightPt * 25.4) / 72),
    rotation: l.rotation,
    marketplace: l.marketplace,
    confidence: l.confidence,
    orderId: l.orderId,
    trackingCode: l.trackingCode,
    sku: l.sku,
    skuKey: l.skuKey,
    blank: l.blank,
    position: l.position,
    excluded: l.excluded,
    duplicateType: l.duplicateType,
    duplicateOfId: l.duplicateOfId,
    duplicateDecision: l.duplicateDecision,
    thumbnailUrl: l.thumbnailKey ? `/api/labels/${l.id}/thumbnail` : null,
  };
}

export type LabelDto = ReturnType<typeof serializeLabel>;

export function serializeBatch(b: Batch) {
  return {
    id: b.id,
    name: b.name,
    status: b.status,
    settings: normalizeSettings(b.settings),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export type BatchDto = ReturnType<typeof serializeBatch>;
