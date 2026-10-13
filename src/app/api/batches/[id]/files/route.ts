import { createHash } from "node:crypto";
import { ApiError, json, requireSession, route, type IdParams } from "@/lib/api";
import { refreshBatchStatus } from "@/lib/batch-service";
import { db } from "@/lib/db";
import { LIMITS, MB } from "@/lib/plans";
import { enqueueAnalyze } from "@/lib/queue";
import { serializeFile } from "@/lib/serializers";
import { keys, storage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

function looksLikePdf(bytes: Uint8Array) {
  return Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString("latin1").includes("%PDF-");
}

function cleanName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "arquivo.pdf";
  return base.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "arquivo.pdf";
}

/** Recebe um PDF por requisição (a interface envia vários em paralelo, com progresso individual). */
export const POST = route(async (req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const batch = await db.batch.findFirst({ where: { id, orgId: s.org.id } });
  if (!batch) throw new ApiError(404, "Unificação não encontrada.");
  if (batch.status === "GENERATING") throw new ApiError(409, "Aguarde a geração do PDF terminar para enviar mais arquivos.");

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > (LIMITS.maxFileSizeMb + 1) * MB) {
    throw new ApiError(413, `Arquivo maior que ${LIMITS.maxFileSizeMb} MB. Divida o PDF em partes menores.`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "Envio inválido. Tente novamente.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Nenhum arquivo recebido.");
  const name = cleanName(file.name);

  if (!/\.pdf$/i.test(name) && file.type !== "application/pdf") {
    throw new ApiError(415, `"${name}" não é um PDF. Envie apenas arquivos .pdf.`);
  }
  if (file.size === 0) throw new ApiError(400, `"${name}" está vazio.`);
  if (file.size > LIMITS.maxFileSizeMb * MB) {
    throw new ApiError(413, `"${name}" tem mais de ${LIMITS.maxFileSizeMb} MB. Divida o PDF em partes menores.`);
  }

  const count = await db.sourceFile.count({ where: { batchId: id } });
  if (count >= LIMITS.maxFilesPerBatch) {
    throw new ApiError(
      409,
      `Cada unificação aceita até ${LIMITS.maxFilesPerBatch} arquivos. Remova algum arquivo ou gere este lote e comece outro.`,
      "TOO_MANY_FILES",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new ApiError(415, `"${name}" não é um PDF válido.`);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { uploadCounter } = await db.batch.update({
    where: { id },
    data: { uploadCounter: { increment: 1 }, status: "ANALYZING" },
    select: { uploadCounter: true },
  });

  const created = await db.sourceFile.create({
    data: {
      batchId: id,
      orgId: s.org.id,
      originalName: name,
      sizeBytes: bytes.length,
      sha256,
      storageKey: "pendente",
      uploadIndex: uploadCounter,
    },
  });
  const storageKey = keys.source(s.org.id, id, created.id);
  try {
    await storage().put(storageKey, bytes, "application/pdf");
  } catch (err) {
    await db.sourceFile.delete({ where: { id: created.id } });
    await refreshBatchStatus(id);
    throw err;
  }
  const saved = await db.sourceFile.update({ where: { id: created.id }, data: { storageKey } });

  try {
    await enqueueAnalyze(saved.id);
  } catch (err) {
    console.error("[upload] fila indisponível", err);
    await db.sourceFile.update({
      where: { id: saved.id },
      data: { status: "ERROR", error: "Serviço de processamento indisponível. Clique em reprocessar em instantes." },
    });
    await refreshBatchStatus(id);
  }
  return json({ file: serializeFile(saved) }, { status: 201 });
});
