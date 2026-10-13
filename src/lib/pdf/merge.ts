/**
 * Junta PDFs parciais em um único arquivo.
 *
 * Com o qpdf (presente na imagem Docker) a junção é feita em disco, sem carregar
 * o resultado inteiro na memória — necessário para lotes de milhares de páginas.
 * Sem qpdf, usa o pdf-lib (adequado para lotes menores e desenvolvimento local).
 */
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

function run(bin: string, args: string[], timeoutMs = 15 * 60_000): Promise<{ code: number | null; out: string; err: string; missing: boolean }> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, out, err: e.message, missing: e.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, missing: false });
    });
  });
}

const qpdfBin = () => process.env.QPDF_PATH || "qpdf";

/** Junta `parts` (na ordem) em `output`. Retorna o número de páginas do resultado. */
export async function mergePdfFiles(parts: string[], output: string): Promise<number> {
  if (parts.length === 1) {
    await writeFile(output, await readFile(parts[0]));
  } else {
    const res = await run(qpdfBin(), ["--empty", "--pages", ...parts, "--", output]);
    if (res.missing) {
      await mergeWithPdfLib(parts, output);
    } else if (res.code !== 0 && res.code !== 3) {
      throw new Error(`Falha ao juntar as partes do PDF: ${res.err.slice(0, 300)}`);
    }
  }
  return countPages(output);
}

async function mergeWithPdfLib(parts: string[], output: string) {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const doc = await PDFDocument.load(await readFile(p), { updateMetadata: false });
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  await writeFile(output, await out.save({ useObjectStreams: true }));
}

/** Conta as páginas do PDF final (qpdf quando disponível, senão pdf-lib). */
export async function countPages(file: string): Promise<number> {
  const res = await run(qpdfBin(), ["--show-npages", file], 5 * 60_000);
  if (!res.missing) {
    if (res.code !== 0 && res.code !== 3) throw new Error(`O PDF gerado está inválido: ${res.err.slice(0, 300)}`);
    const n = Number(res.out.trim());
    if (!Number.isFinite(n)) throw new Error("Não foi possível contar as páginas do PDF gerado.");
    return n;
  }
  const doc = await PDFDocument.load(await readFile(file), { updateMetadata: false });
  return doc.getPageCount();
}

export async function fileSize(file: string) {
  return (await stat(file)).size;
}
