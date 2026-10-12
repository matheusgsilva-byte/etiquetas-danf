/**
 * Carregamento do pdf.js no Node (apenas no worker).
 *
 * O pdf.js é usado para extrair texto (detecção de marketplace e de
 * número de pedido) e para renderizar páginas (miniaturas, recorte automático
 * de margens em branco e impressão digital visual para detectar duplicidades).
 * A renderização usa @napi-rs/canvas, dependência opcional do pdfjs-dist.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJs> | null = null;
let assetDirs: { standardFonts: string; cmaps: string; wasm: string } | null = null;

function resolveAssets() {
  if (assetDirs) return assetDirs;
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  // pdf.js aceita caminhos de sistema de arquivos no Node, terminados em "/".
  assetDirs = {
    standardFonts: path.join(pkgDir, "standard_fonts") + path.sep,
    cmaps: path.join(pkgDir, "cmaps") + path.sep,
    wasm: path.join(pkgDir, "wasm") + path.sep,
  };
  return assetDirs;
}

export async function getPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const require = createRequire(import.meta.url);
      const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      lib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      return lib;
    })();
  }
  return pdfjsPromise;
}

export async function openWithPdfJs(bytes: Uint8Array) {
  const pdfjs = await getPdfJs();
  const assets = resolveAssets();
  // O pdf.js transfere o buffer para o worker; passamos uma cópia para não
  // invalidar o buffer original, que ainda será usado pelo pdf-lib.
  const data = new Uint8Array(bytes);
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: assets.standardFonts,
    cMapUrl: assets.cmaps,
    cMapPacked: true,
    wasmUrl: assets.wasm,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  // No pdf.js 5+ a liberação de recursos é feita pela tarefa de carregamento.
  return Object.assign(pdf, { close: () => task.destroy() });
}
