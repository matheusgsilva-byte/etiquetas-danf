/**
 * Geometria de posicionamento das etiquetas nas páginas de saída.
 * Funções puras — fáceis de testar.
 */
import { MM_TO_PT, OUTPUT_FORMATS, type OutputSettings } from "../output-settings";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  /** Ponto de origem para drawPage (já compensado pela rotação). */
  x: number;
  y: number;
  scale: number;
  /** Rotação anti-horária aplicada ao desenhar (graus). */
  rotate: 0 | 90 | 180 | 270;
  /** Se foi aplicada rotação adicional de 90° para encaixar a orientação. */
  autoRotated: boolean;
  drawnWidth: number;
  drawnHeight: number;
}

export interface PageGeometry {
  width: number;
  height: number;
  cells: Box[];
}

const A4 = { width: 210 * MM_TO_PT, height: 297 * MM_TO_PT };

/** Página de saída e células onde as etiquetas serão posicionadas. */
export function pageGeometry(settings: OutputSettings): PageGeometry | null {
  if (settings.format === "ORIGINAL") return null;
  const fmt = OUTPUT_FORMATS[settings.format];
  const width = fmt.widthMm * MM_TO_PT;
  const height = fmt.heightMm * MM_TO_PT;
  const m = settings.marginMm * MM_TO_PT;

  if (settings.format !== "A4" || settings.perSheet === 1) {
    return { width, height, cells: [{ x: m, y: m, width: width - 2 * m, height: height - 2 * m }] };
  }

  const cells: Box[] = [];
  if (settings.perSheet === 2) {
    // Duas linhas (metade superior e inferior) — cada célula 210 × 148,5 mm.
    const ch = A4.height / 2;
    for (const row of [1, 0]) {
      cells.push({ x: m, y: row * ch + m, width: A4.width - 2 * m, height: ch - 2 * m });
    }
  } else {
    // 2 × 2 — cada célula 105 × 148,5 mm. Ordem: esquerda→direita, cima→baixo.
    const cw = A4.width / 2;
    const ch = A4.height / 2;
    for (const row of [1, 0]) {
      for (const col of [0, 1]) {
        cells.push({ x: col * cw + m, y: row * ch + m, width: cw - 2 * m, height: ch - 2 * m });
      }
    }
  }
  return { width: A4.width, height: A4.height, cells };
}

/**
 * Calcula como desenhar uma caixa de conteúdo (em coordenadas da página de
 * origem, sem rotação) dentro de uma célula.
 *
 * @param sourceRotation rotação /Rotate da página de origem (horária, em graus)
 */
export function placeInCell(
  box: Box,
  sourceRotation: number,
  cell: Box,
  opts: { scaleMode: "FIT" | "FILL"; autoRotate: boolean },
): Placement {
  const src = (((sourceRotation % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const srcSwap = src === 90 || src === 270;
  const dispW = srcSwap ? box.height : box.width;
  const dispH = srcSwap ? box.width : box.height;

  const evaluate = (extra: boolean) => {
    const w = extra ? dispH : dispW;
    const h = extra ? dispW : dispH;
    const fit = Math.min(cell.width / w, cell.height / h);
    const scale = opts.scaleMode === "FIT" ? Math.min(1, fit) : fit;
    return { extra, w, h, scale };
  };

  let choice = evaluate(false);
  if (opts.autoRotate) {
    const rotated = evaluate(true);
    // Gira apenas se melhora a escala (ex.: etiqueta paisagem em página retrato).
    if (rotated.scale > choice.scale + 1e-6) choice = rotated;
  }

  const s = choice.scale;
  const drawnWidth = choice.w * s;
  const drawnHeight = choice.h * s;
  const bx = cell.x + (cell.width - drawnWidth) / 2;
  const by = cell.y + (cell.height - drawnHeight) / 2;

  // pdf-lib gira no sentido anti-horário; /Rotate é horário.
  const rotate = (((360 - src + (choice.extra ? 90 : 0)) % 360) as 0 | 90 | 180 | 270);
  const w = box.width * s;
  const h = box.height * s;
  let x = bx;
  let y = by;
  switch (rotate) {
    case 90:
      x = bx + h;
      break;
    case 180:
      x = bx + w;
      y = by + h;
      break;
    case 270:
      y = by + w;
      break;
  }
  return { x, y, scale: s, rotate, autoRotated: choice.extra, drawnWidth, drawnHeight };
}

/** Decide qual caixa usar: conteúdo recortado ou a página inteira. */
export function effectiveBox(cropBox: Box, contentBox: Box | null, trim: boolean): Box {
  if (!trim || !contentBox) return cropBox;
  const cropArea = cropBox.width * cropBox.height;
  const contentArea = contentBox.width * contentBox.height;
  // Só recorta quando há margem branca relevante; evita alterar etiquetas já justas.
  if (contentArea <= 0 || contentArea / cropArea > 0.92) return cropBox;
  return contentBox;
}
