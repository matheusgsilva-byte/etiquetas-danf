/**
 * Montagem do PDF unificado em blocos, para lotes muito grandes (milhares de
 * etiquetas). Cada bloco é montado, validado e gravado em disco; os PDFs de
 * origem ficam em memória só enquanto o bloco precisa deles; no fim os blocos
 * são juntados em disco (qpdf). Assim o uso de memória não cresce com o lote.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PDFDocument } from "pdf-lib";
import type { OutputSettings } from "../output-settings";
import { composeDocument, validateOutput, type ComposeEntry, type ComposeWarning } from "./compose";
import { fileSize, mergePdfFiles } from "./merge";

/** Etiquetas por bloco (múltiplo de 1, 2 e 4 para não quebrar folhas A4). */
export const CHUNK_SIZE = 240;
/** PDFs de origem mantidos abertos ao mesmo tempo (os mais recentes). */
const OPEN_SOURCES = 4;

export interface ChunkedResult {
  file: string;
  dir: string;
  pageCount: number;
  labelCount: number;
  size: number;
  warnings: ComposeWarning[];
}

export async function composeToFile(
  entries: ComposeEntry[],
  options: {
    settings: OutputSettings;
    loadSource: (sourceId: string) => Promise<PDFDocument>;
    title?: string;
    onProgress?: (done: number, total: number) => void | Promise<void>;
  },
): Promise<ChunkedResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "labelhub-out-"));
  try {
    // Separa em blocos; uma página separadora sempre começa um bloco novo.
    const chunks: ComposeEntry[][] = [];
    let current: ComposeEntry[] = [];
    let labelsInCurrent = 0;
    for (const e of entries) {
      if ((e.kind === "separator" && current.length) || labelsInCurrent >= CHUNK_SIZE) {
        chunks.push(current);
        current = [];
        labelsInCurrent = 0;
      }
      current.push(e);
      if (e.kind === "label") labelsInCurrent++;
    }
    if (current.length) chunks.push(current);

    const parts: string[] = [];
    const warnings: ComposeWarning[] = [];
    let pageCount = 0;
    let labelCount = 0;
    let done = 0;
    const total = entries.length;

    // Poucos PDFs de origem abertos por vez (os usados mais recentemente).
    const cache = new Map<string, PDFDocument>();
    const load = async (id: string) => {
      let doc = cache.get(id);
      if (doc) {
        cache.delete(id);
      } else {
        doc = await options.loadSource(id);
        while (cache.size >= OPEN_SOURCES) cache.delete(cache.keys().next().value!);
      }
      cache.set(id, doc);
      return doc;
    };

    for (const [i, chunk] of chunks.entries()) {
      const r = await composeDocument(chunk, {
        settings: options.settings,
        loadSource: load,
        // Mais recentes primeiro: reaproveita os PDFs que ficaram abertos do bloco anterior.
        preferredSources: [...cache.keys()].reverse(),
        title: options.title,
        onProgress: (d) => options.onProgress?.(done + d, total),
      });
      await validateOutput(r.bytes, r);
      const part = path.join(dir, `parte-${String(i).padStart(4, "0")}.pdf`);
      await writeFile(part, r.bytes);
      parts.push(part);
      pageCount += r.pageCount;
      labelCount += r.labelCount;
      warnings.push(...r.warnings);
      done += chunk.length;
    }

    const file = path.join(dir, "unificado.pdf");
    const merged = await mergePdfFiles(parts, file);
    if (merged !== pageCount) {
      throw new Error(`O PDF final tem ${merged} páginas, mas eram esperadas ${pageCount}.`);
    }
    for (const p of parts) await rm(p, { force: true });
    return { file, dir, pageCount, labelCount, size: await fileSize(file), warnings };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
