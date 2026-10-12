/**
 * Análise de um PDF de etiquetas (executada no worker).
 *
 * Para cada página: dimensões, rotação, texto, marketplace, nº do pedido,
 * código de rastreio, caixa de conteúdo (para recorte de margens em branco),
 * impressão digital visual (para duplicidades) e miniatura JPEG.
 */
import { createHash } from "node:crypto";
import type { PDFDocument } from "pdf-lib";
import {
  detectMarketplace,
  extractIdentifiers,
  type MarketplaceId,
} from "../marketplaces";
import { loadPdfForProcessing } from "./load";
import { openWithPdfJs } from "./pdfjs";
import type { Box } from "./layout";

export interface PageAnalysis {
  index: number;
  /** Dimensões exibidas (já considerando a rotação da página), em pontos. */
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
  cropBox: Box;
  /** Área com conteúdo (sem margens brancas), em coordenadas do PDF. Null se não foi possível calcular. */
  contentBox: Box | null;
  text: string;
  marketplace: MarketplaceId;
  confidence: "alta" | "media" | "baixa";
  orderId: string | null;
  trackingCode: string | null;
  fingerprint: string | null;
  thumbnail: Buffer | null;
  blank: boolean;
}

export interface FileAnalysis {
  pageCount: number;
  pages: PageAnalysis[];
  marketplace: MarketplaceId;
  repaired: boolean;
  /** Bytes normalizados (presente apenas quando o arquivo foi reparado). */
  normalizedBytes: Uint8Array | null;
}

export interface AnalyzeOptions {
  render?: boolean;
  onPage?: (done: number, total: number) => void | Promise<void>;
}

const INK_THRESHOLD = 235;
const RENDER_MAX_SIDE_PX = 640;
const THUMB_MAX_SIDE_PX = 320;

function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const r = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

interface RenderResult {
  contentBox: Box | null;
  fingerprint: string;
  thumbnail: Buffer | null;
  blank: boolean;
}

type PdfJsDoc = Awaited<ReturnType<typeof openWithPdfJs>>;

async function renderPage(
  pdf: PdfJsDoc,
  pageNumber: number,
  rotation: number,
): Promise<RenderResult | null> {
  const page = await pdf.getPage(pageNumber);
  try {
    const [vx1, vy1, vx2, vy2] = page.view;
    const viewW = vx2 - vx1;
    const viewH = vy2 - vy1;
    const scale = Math.min(1.5, RENDER_MAX_SIDE_PX / Math.max(viewW, viewH));
    // Renderiza SEM a rotação da página para mapear pixels direto às coordenadas do PDF.
    const viewport = page.getViewport({ scale, rotation: 0 });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const factory = (pdf as any).canvasFactory;
    const { canvas, context } = factory.create(width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;

    const img = context.getImageData(0, 0, width, height).data as Uint8ClampedArray;
    const gray = Buffer.alloc(width * height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = (img[i] * 299 + img[i + 1] * 587 + img[i + 2] * 114) / 1000;
        gray[y * width + x] = lum >> 4; // quantização reduz ruído de antisserrilhado
        if (lum < INK_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const blank = maxX < 0;
    const fingerprint = createHash("sha256").update(`${width}x${height}:`).update(gray).digest("hex");

    let contentBox: Box | null = null;
    if (!blank) {
      const pad = 4; // pontos
      const left = Math.max(vx1, vx1 + minX / scale - pad);
      const right = Math.min(vx2, vx1 + (maxX + 1) / scale + pad);
      const top = Math.min(vy2, vy2 - minY / scale + pad);
      const bottom = Math.max(vy1, vy2 - (maxY + 1) / scale - pad);
      contentBox = { x: left, y: bottom, width: right - left, height: top - bottom };
    }

    // Miniatura com a rotação aplicada, como o usuário verá a etiqueta.
    let thumbnail: Buffer | null = null;
    try {
      const rot = normalizeRotation(rotation);
      const swap = rot === 90 || rot === 270;
      const tScale = Math.min(1, THUMB_MAX_SIDE_PX / Math.max(width, height));
      const tw = Math.max(1, Math.round((swap ? height : width) * tScale));
      const th = Math.max(1, Math.round((swap ? width : height) * tScale));
      const thumb = factory.create(tw, th);
      const ctx = thumb.context;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tw, th);
      ctx.translate(tw / 2, th / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.drawImage(canvas, (-width * tScale) / 2, (-height * tScale) / 2, width * tScale, height * tScale);
      thumbnail = Buffer.from(await thumb.canvas.encode("jpeg", 82));
      factory.destroy?.(thumb);
    } catch {
      thumbnail = null;
    }
    factory.destroy?.({ canvas, context });
    return { contentBox, fingerprint, thumbnail, blank };
  } finally {
    page.cleanup();
  }
}

function dominant<T extends string>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (v === fallback) continue;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export async function analyzePdf(
  input: Uint8Array,
  filename: string,
  options: AnalyzeOptions = {},
): Promise<FileAnalysis> {
  const { doc, bytes, repaired } = await loadPdfForProcessing(input);
  return analyzeLoaded(doc, bytes, repaired, filename, options);
}

async function analyzeLoaded(
  doc: PDFDocument,
  bytes: Uint8Array,
  repaired: boolean,
  filename: string,
  options: AnalyzeOptions,
): Promise<FileAnalysis> {
  const render = options.render !== false;
  const pageCount = doc.getPageCount();
  let pdf: PdfJsDoc | null = null;
  try {
    pdf = await openWithPdfJs(bytes);
  } catch {
    pdf = null; // texto e miniaturas indisponíveis, mas a unificação continua possível
  }

  const pages: PageAnalysis[] = [];
  try {
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const rotation = normalizeRotation(page.getRotation().angle);
      const crop = page.getCropBox();
      const cropBox: Box = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
      const swap = rotation === 90 || rotation === 270;

      let text = "";
      let rendered: RenderResult | null = null;
      if (pdf) {
        try {
          const p = await pdf.getPage(i + 1);
          const content = await p.getTextContent();
          text = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 20_000);
          p.cleanup();
        } catch {
          text = "";
        }
        if (render) {
          try {
            rendered = await renderPage(pdf, i + 1, rotation);
          } catch {
            rendered = null;
          }
        }
      }

      const detection = detectMarketplace(text, filename);
      const ids = extractIdentifiers(text, detection.marketplace);
      const fingerprint =
        rendered?.fingerprint ??
        (text.length > 30 ? createHash("sha256").update("txt:").update(text).digest("hex") : null);

      pages.push({
        index: i,
        widthPt: swap ? cropBox.height : cropBox.width,
        heightPt: swap ? cropBox.width : cropBox.height,
        rotation,
        cropBox,
        contentBox: rendered?.contentBox ?? null,
        text,
        marketplace: detection.marketplace,
        confidence: detection.confidence,
        orderId: ids.orderId,
        trackingCode: ids.trackingCode,
        fingerprint,
        thumbnail: rendered?.thumbnail ?? null,
        blank: rendered?.blank ?? false,
      });
      // Libera fontes e objetos em cache do pdf.js periodicamente: PDFs com
      // fontes embutidas por página (comum em DANFEs) esgotariam a memória.
      if (pdf && (i + 1) % 5 === 0) await pdf.cleanup().catch(() => undefined);
      await options.onPage?.(i + 1, pageCount);
    }
  } finally {
    await pdf?.close();
  }

  // Páginas sem texto reconhecível herdam o marketplace predominante do arquivo.
  const fileMarketplace = dominant(pages.map((p) => p.marketplace), "outros" as MarketplaceId);
  const filenameGuess = detectMarketplace("", filename).marketplace;
  const fallback = fileMarketplace !== "outros" ? fileMarketplace : filenameGuess;
  for (const p of pages) {
    if (p.marketplace === "outros" && fallback !== "outros") {
      p.marketplace = fallback;
      p.confidence = "baixa";
    }
  }

  return {
    pageCount,
    pages,
    marketplace: fallback,
    repaired,
    normalizedBytes: repaired ? bytes : null,
  };
}
