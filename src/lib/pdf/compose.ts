/**
 * Montagem do PDF unificado.
 *
 * As páginas de origem são incorporadas como Form XObjects (pdf-lib
 * `embedPage`), o que preserva o conteúdo vetorial — textos, códigos de barras
 * e QR Codes não são rasterizados. No modo "Tamanho original" as páginas são
 * copiadas integralmente (`copyPages`).
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { MIN_READABLE_SCALE, MM_TO_PT, type OutputSettings } from "../output-settings";
import { effectiveBox, pageGeometry, placeInCell, type Box } from "./layout";

export interface LabelEntry {
  kind: "label";
  /** Identificador da etiqueta (usado em avisos). */
  ref: string;
  /** Identificador do arquivo de origem. */
  sourceId: string;
  pageIndex: number;
  cropBox: Box;
  contentBox: Box | null;
  rotation: number;
}

export interface SeparatorEntry {
  kind: "separator";
  title: string;
  subtitle: string;
}

export type ComposeEntry = LabelEntry | SeparatorEntry;

export interface ComposeWarning {
  ref: string;
  message: string;
}

export interface ComposeResult {
  bytes: Uint8Array;
  pageCount: number;
  labelCount: number;
  warnings: ComposeWarning[];
  /** Tamanho esperado de cada página, para validação. */
  pageSizes: { width: number; height: number }[];
}

export interface ComposeOptions {
  settings: OutputSettings;
  loadSource: (sourceId: string) => Promise<PDFDocument>;
  onProgress?: (done: number, total: number) => void | Promise<void>;
  title?: string;
  /** Arquivos de origem já abertos: processados primeiro para evitar recarregar. */
  preferredSources?: string[];
}

const SEPARATOR_SIZE = { width: 100 * MM_TO_PT, height: 150 * MM_TO_PT };

function winAnsi(text: string) {
  // Helvetica padrão usa WinAnsi: mantém acentos do português, troca o resto.
  return text.replace(/[^\x20-\x7E -ÿ]/g, "?");
}

function drawSeparator(page: PDFPage, font: PDFFont, bold: PDFFont, entry: SeparatorEntry) {
  const { width, height } = page.getSize();
  const title = winAnsi(entry.title);
  let size = Math.min(36, width / 8);
  while (size > 10 && bold.widthOfTextAtSize(title, size) > width - 40) size -= 1;
  page.drawRectangle({ x: 12, y: 12, width: width - 24, height: height - 24, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  page.drawText(title, {
    x: (width - bold.widthOfTextAtSize(title, size)) / 2,
    y: height / 2 + 6,
    size,
    font: bold,
  });
  const sub = winAnsi(entry.subtitle);
  const subSize = Math.min(14, size * 0.5);
  page.drawText(sub, {
    x: (width - font.widthOfTextAtSize(sub, subSize)) / 2,
    y: height / 2 - subSize - 10,
    size: subSize,
    font,
  });
  const brand = "LabelHub Cloud - separador";
  page.drawText(brand, {
    x: (width - font.widthOfTextAtSize(brand, 8)) / 2,
    y: 24,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
}

function drawCutLines(page: PDFPage, cells: Box[]) {
  const { width, height } = page.getSize();
  const style = { thickness: 0.4, color: rgb(0.6, 0.6, 0.6), dashArray: [4, 4] };
  // Linhas no meio do espaço entre células (as células já incluem margens).
  if (cells.length === 4) {
    page.drawLine({ start: { x: width / 2, y: 0 }, end: { x: width / 2, y: height }, ...style });
  }
  if (cells.length >= 2) {
    page.drawLine({ start: { x: 0, y: height / 2 }, end: { x: width, y: height / 2 }, ...style });
  }
}

export async function composeDocument(entries: ComposeEntry[], options: ComposeOptions): Promise<ComposeResult> {
  const { settings } = options;
  const out = await PDFDocument.create();
  out.setTitle(options.title ?? "Etiquetas unificadas");
  out.setProducer("LabelHub Cloud");
  out.setCreator("LabelHub Cloud");
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  const geometry = pageGeometry(settings);
  const warnings: { order: number; warning: ComposeWarning }[] = [];
  const pageSizes: ({ width: number; height: number } | null)[] = [];
  const total = entries.length;

  // ---------------------------------------------------------------- 1ª etapa
  // Monta todas as folhas e decide onde cada etiqueta vai, na ordem pedida.
  // Assim a 2ª etapa pode abrir cada PDF de origem uma única vez, mesmo quando
  // as etiquetas de vários arquivos aparecem intercaladas.
  interface Task {
    order: number;
    entry: LabelEntry;
    pageIndex: number; // posição da folha no PDF de saída
    cell: Box | null; // null = tamanho original (cópia da página)
  }
  const tasks: Task[] = [];
  let currentPage: number | null = null;
  let cellIndex = 0;

  entries.forEach((entry, order) => {
    if (entry.kind === "separator") {
      const size = geometry ? { width: geometry.width, height: geometry.height } : SEPARATOR_SIZE;
      drawSeparator(out.addPage([size.width, size.height]), font, bold, entry);
      pageSizes.push(size);
      currentPage = null; // a próxima etiqueta começa em folha nova
      return;
    }
    if (!geometry) {
      // Tamanho original: reserva a posição; a página é copiada na 2ª etapa.
      out.addPage([entry.cropBox.width || 100, entry.cropBox.height || 100]);
      pageSizes.push(null);
      tasks.push({ order, entry, pageIndex: out.getPageCount() - 1, cell: null });
      return;
    }
    if (currentPage === null || cellIndex >= geometry.cells.length) {
      const page = out.addPage([geometry.width, geometry.height]);
      pageSizes.push({ width: geometry.width, height: geometry.height });
      if (settings.cutLines && geometry.cells.length > 1) drawCutLines(page, geometry.cells);
      currentPage = out.getPageCount() - 1;
      cellIndex = 0;
    }
    tasks.push({ order, entry, pageIndex: currentPage, cell: geometry.cells[cellIndex++] });
  });

  // ---------------------------------------------------------------- 2ª etapa
  // Agrupa por arquivo de origem; os que já estão abertos vêm primeiro.
  const bySource = new Map<string, Task[]>();
  for (const t of tasks) {
    const list = bySource.get(t.entry.sourceId);
    if (list) list.push(t);
    else bySource.set(t.entry.sourceId, [t]);
  }
  const preferred = (options.preferredSources ?? []).filter((id) => bySource.has(id));
  const sourceOrder = [...preferred, ...[...bySource.keys()].filter((id) => !preferred.includes(id))];

  let done = entries.length - tasks.length; // separadores já prontos
  for (const sourceId of sourceOrder) {
    const list = bySource.get(sourceId)!;
    const source = await options.loadSource(sourceId);
    for (const t of list) {
      if (t.entry.pageIndex < 0 || t.entry.pageIndex >= source.getPageCount()) {
        throw new Error(`Página ${t.entry.pageIndex + 1} não encontrada no arquivo de origem (${t.entry.ref}).`);
      }
    }

    if (!geometry) {
      const copied = await out.copyPages(source, list.map((t) => t.entry.pageIndex));
      copied.forEach((page, i) => {
        const pos = list[i].pageIndex;
        out.removePage(pos);
        out.insertPage(pos, page);
        const { width, height } = page.getSize();
        const rot = (((page.getRotation().angle % 360) + 360) % 360);
        pageSizes[pos] = rot === 90 || rot === 270 ? { width: height, height: width } : { width, height };
      });
    } else {
      for (const t of list) {
        const box = effectiveBox(t.entry.cropBox, t.entry.contentBox, settings.trimWhitespace);
        const placement = placeInCell(box, t.entry.rotation, t.cell!, {
          scaleMode: settings.scaleMode,
          autoRotate: settings.autoRotate,
        });
        const embedded = await out.embedPage(source.getPage(t.entry.pageIndex), {
          left: box.x,
          bottom: box.y,
          right: box.x + box.width,
          top: box.y + box.height,
        });
        out.getPage(t.pageIndex).drawPage(embedded, {
          x: placement.x,
          y: placement.y,
          xScale: placement.scale,
          yScale: placement.scale,
          rotate: degrees(placement.rotate),
        });
        if (placement.scale < MIN_READABLE_SCALE) {
          warnings.push({
            order: t.order,
            warning: {
              ref: t.entry.ref,
              message: `Etiqueta reduzida para ${Math.round(placement.scale * 100)}% para caber no formato escolhido. Confira a leitura do código de barras ou use outro formato.`,
            },
          });
        }
      }
    }
    done += list.length;
    if (options.onProgress) await options.onProgress(done, total);
  }

  if (out.getPageCount() === 0) throw new Error("Nenhuma página foi gerada.");
  const bytes = await out.save({ useObjectStreams: true });
  return {
    bytes,
    pageCount: out.getPageCount(),
    labelCount: tasks.length,
    warnings: warnings.sort((a, b) => a.order - b.order).map((w) => w.warning),
    pageSizes: pageSizes.map((p) => p ?? { width: 0, height: 0 }),
  };
}

/**
 * Confirma que o arquivo gerado é um PDF válido, com a quantidade e o tamanho
 * de páginas esperados. Lança erro se algo não confere — o resultado só é
 * disponibilizado depois desta verificação.
 */
export async function validateOutput(bytes: Uint8Array, expected: { pageCount: number; pageSizes: { width: number; height: number }[] }) {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    throw new Error(`O PDF gerado não pôde ser reaberto para validação: ${(err as Error).message}`);
  }
  const count = doc.getPageCount();
  if (count !== expected.pageCount) {
    throw new Error(`O PDF gerado tem ${count} páginas, mas eram esperadas ${expected.pageCount}.`);
  }
  doc.getPages().forEach((page, i) => {
    const { width, height } = page.getSize();
    const rot = (((page.getRotation().angle % 360) + 360) % 360);
    const shown = rot === 90 || rot === 270 ? { width: height, height: width } : { width, height };
    const exp = expected.pageSizes[i];
    if (exp && (Math.abs(shown.width - exp.width) > 0.5 || Math.abs(shown.height - exp.height) > 0.5)) {
      throw new Error(`A página ${i + 1} do PDF gerado tem tamanho inesperado.`);
    }
  });
  return { pageCount: count };
}
