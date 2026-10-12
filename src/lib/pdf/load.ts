/**
 * Carregamento seguro de PDFs enviados pelo usuário.
 *
 * - Verifica a assinatura "%PDF-".
 * - Tenta abrir com pdf-lib.
 * - Se o arquivo estiver protegido apenas por senha de proprietário (comum em
 *   etiquetas) ou com a estrutura danificada, tenta normalizar com o qpdf
 *   (`qpdf --decrypt`), quando disponível no servidor.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

export type PdfErrorCode = "NOT_PDF" | "ENCRYPTED" | "CORRUPTED" | "EMPTY";

export class PdfInputError extends Error {
  constructor(
    public code: PdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PdfInputError";
  }
}

export const PDF_ERROR_MESSAGES: Record<PdfErrorCode, string> = {
  NOT_PDF: "O arquivo não é um PDF válido.",
  ENCRYPTED: "O PDF está protegido por senha e não pode ser aberto.",
  CORRUPTED: "O PDF está corrompido ou danificado e não pôde ser lido.",
  EMPTY: "O PDF não contém páginas.",
};

export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString("latin1");
  return head.includes("%PDF-");
}

function runQpdf(args: string[]): Promise<{ code: number | null; stderr: string; missing: boolean }> {
  return new Promise((resolve) => {
    const bin = process.env.QPDF_PATH || "qpdf";
    let stderr = "";
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      resolve({ code: null, stderr: "", missing: true });
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: String(err.message), missing: err.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, missing: false });
    });
  });
}

/** Reescreve o PDF com o qpdf (remove criptografia de proprietário e repara a estrutura). */
async function normalizeWithQpdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "labelhub-"));
  const input = path.join(dir, "in.pdf");
  const output = path.join(dir, "out.pdf");
  try {
    await writeFile(input, bytes);
    const res = await runQpdf(["--decrypt", "--object-streams=preserve", input, output]);
    // qpdf: 0 = ok, 3 = ok com avisos (arquivo reparado).
    if (res.missing || (res.code !== 0 && res.code !== 3)) return null;
    return new Uint8Array(await readFile(output));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface LoadedPdf {
  doc: PDFDocument;
  /** Bytes efetivamente utilizados (podem ter sido normalizados pelo qpdf). */
  bytes: Uint8Array;
  repaired: boolean;
}

async function tryLoad(bytes: Uint8Array): Promise<{ doc?: PDFDocument; encrypted?: boolean; error?: unknown }> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { doc };
  } catch (error) {
    const name = (error as Error)?.name ?? "";
    const message = (error as Error)?.message ?? "";
    if (name === "EncryptedPDFError" || /encrypt/i.test(message)) return { encrypted: true, error };
    return { error };
  }
}

export async function loadPdfForProcessing(input: Uint8Array): Promise<LoadedPdf> {
  if (!looksLikePdf(input)) throw new PdfInputError("NOT_PDF", PDF_ERROR_MESSAGES.NOT_PDF);

  let bytes = input;
  let repaired = false;
  let attempt = await tryLoad(bytes);

  if (!attempt.doc) {
    const normalized = await normalizeWithQpdf(bytes);
    if (normalized) {
      const second = await tryLoad(normalized);
      if (second.doc) {
        attempt = second;
        bytes = normalized;
        repaired = true;
      }
    }
  }

  if (!attempt.doc) {
    if (attempt.encrypted) throw new PdfInputError("ENCRYPTED", PDF_ERROR_MESSAGES.ENCRYPTED);
    throw new PdfInputError("CORRUPTED", PDF_ERROR_MESSAGES.CORRUPTED);
  }

  if (attempt.doc.getPageCount() === 0) throw new PdfInputError("EMPTY", PDF_ERROR_MESSAGES.EMPTY);
  return { doc: attempt.doc, bytes, repaired };
}
