/**
 * Gera PDFs de etiquetas de exemplo (fictícias) para testar o LabelHub:
 * tamanhos, orientações e origens diferentes, códigos de barras Code 128
 * vetoriais e em imagem, duplicidades e arquivos inválidos.
 *
 *   npx tsx scripts/generate-sample-labels.ts [pasta-de-saída]
 *
 * Os dados são inventados — servem apenas para testes.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, PDFPage, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";

const MM = 72 / 25.4;

// ---------------------------------------------------------------- Code 128 (B)
const CODE128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

/** Larguras alternadas barra/espaço (em módulos) para o texto em Code 128 B. */
export function code128Modules(text: string): number[] {
  const values = [104];
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Caractere não suportado: ${ch}`);
    values.push(v);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, 106);
  return values.flatMap((v) => CODE128[v].split("").map(Number));
}

function drawBarcode(page: PDFPage, text: string, x: number, y: number, height: number, module = 1.1) {
  let cx = x + 10 * module; // zona de silêncio
  code128Modules(text).forEach((w, i) => {
    if (i % 2 === 0) page.drawRectangle({ x: cx, y, width: w * module, height, color: rgb(0, 0, 0) });
    cx += w * module;
  });
  return cx + 10 * module - x;
}

// ------------------------------------------------------------------- EAN-13
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13(code12: string): string {
  const d = code12.split("").map(Number);
  const sum = d.reduce((acc, v, i) => acc + v * (i % 2 === 0 ? 1 : 3), 0);
  return code12 + ((10 - (sum % 10)) % 10);
}

/** Sequência de 95 módulos (1 = barra) do EAN-13. */
export function ean13Bits(code: string): string {
  const d = code.split("").map(Number);
  const parity = EAN_PARITY[d[0]];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? EAN_L : EAN_G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R[d[i]];
  return bits + "101";
}

function drawEan13(page: PDFPage, font: PDFFont, code: string, x: number, y: number, height: number, module = 0.94) {
  const bits = ean13Bits(code);
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "1") {
      let j = i;
      while (j < bits.length && bits[j] === "1") j++;
      page.drawRectangle({ x: x + i * module, y, width: (j - i) * module, height, color: rgb(0, 0, 0) });
      i = j;
    } else i++;
  }
  page.drawText(code, { x, y: y - 10, size: 8, font });
}

// ---------------------------------------------------------- PNG em tons de cinza
function pngGray(width: number, height: number, pixel: (x: number, y: number) => number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = pixel(x, y);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function eanPng(code: string, moduleSize = 3, height = 110) {
  const bits = ean13Bits(code);
  const quiet = 11;
  const width = (bits.length + quiet * 2) * moduleSize;
  return pngGray(width, height, (x) => {
    const m = Math.floor(x / moduleSize) - quiet;
    return m >= 0 && m < bits.length && bits[m] === "1" ? 0 : 255;
  });
}

function barcodePng(text: string, moduleSize = 3, height = 120) {
  const modules = code128Modules(text);
  const quiet = 12;
  const total = modules.reduce((a, b) => a + b, 0) + quiet * 2;
  const bars: boolean[] = new Array(quiet).fill(false);
  modules.forEach((w, i) => {
    for (let k = 0; k < w; k++) bars.push(i % 2 === 0);
  });
  while (bars.length < total) bars.push(false);
  return pngGray(total * moduleSize, height, (x) => (bars[Math.floor(x / moduleSize)] ? 0 : 255));
}

// -------------------------------------------------------------------- Etiquetas
interface LabelSpec {
  marketplace: string;
  marker: string; // texto único (ex.: LBL-001) usado nos testes de ordem
  lines: string[];
  barcode: string;
  ean: string;
}

function drawLabel(page: PDFPage, font: PDFFont, bold: PDFFont, spec: LabelSpec, area: { x: number; y: number; w: number; h: number }) {
  const { x, y, w, h } = area;
  page.drawRectangle({ x: x + 4, y: y + 4, width: w - 8, height: h - 8, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  page.drawText(spec.marketplace, { x: x + 14, y: y + h - 34, size: 16, font: bold });
  page.drawText(spec.marker, { x: x + w - 14 - bold.widthOfTextAtSize(spec.marker, 10), y: y + h - 30, size: 10, font: bold });
  let ty = y + h - 58;
  for (const line of spec.lines) {
    page.drawText(line, { x: x + 14, y: ty, size: 9, font });
    ty -= 13;
  }
  const bcHeight = Math.min(70, h * 0.22);
  drawEan13(page, font, spec.ean, x + 20, y + 40 + bcHeight + 24, 42);
  drawBarcode(page, spec.barcode, x + 14, y + 40, bcHeight, Math.min(1.2, (w - 40) / (code128Modules(spec.barcode).reduce((a, b) => a + b, 0) + 20)));
  page.drawText(spec.barcode, { x: x + 20, y: y + 26, size: 9, font });
}

async function newDoc() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}

const DEST = ["Destinatário: Cliente Teste", "Rua Exemplo, 123 - Centro", "São Paulo - SP - 01000-000"];

export async function generateSamples(outDir: string) {
  const eans: string[] = [];
  let seq = 0;
  const nextEan = () => {
    const code = ean13(`7891000${String(++seq).padStart(5, "0")}`);
    eans.push(code);
    return code;
  };
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const files: Record<string, string> = {};
  const save = async (name: string, doc: PDFDocument) => {
    const p = path.join(outDir, name);
    writeFileSync(p, await doc.save());
    files[name] = p;
  };

  // 1) Mercado Livre — 3 etiquetas 10x15 retrato, códigos vetoriais.
  {
    const { doc, font, bold } = await newDoc();
    for (let i = 1; i <= 3; i++) {
      const page = doc.addPage([100 * MM, 150 * MM]);
      drawLabel(page, font, bold, {
        marketplace: "Mercado Livre",
        marker: `LBL-ML-${i}`,
        lines: [`Venda: 200000${7000000 + i}`, `Envio: 4${4100000 + i}000`, "Mercado Envios", ...DEST],
        barcode: `MLB${7000000 + i}`,
      ean: nextEan(),
      }, { x: 0, y: 0, w: 100 * MM, h: 150 * MM });
    }
    await save("mercado-livre-10x15.pdf", doc);
  }

  // 2) Shopee — A4 retrato com a etiqueta no canto superior (testa recorte de margens).
  {
    const { doc, font, bold } = await newDoc();
    for (let i = 1; i <= 2; i++) {
      const page = doc.addPage([210 * MM, 297 * MM]);
      drawLabel(page, font, bold, {
        marketplace: "Shopee Xpress",
        marker: `LBL-SP-${i}`,
        lines: [`Pedido: 241012${i}ABCDEFG`.slice(0, 22), `Rastreio: BR2600000000${i}5`, "SPX", ...DEST],
        barcode: `BR2600000000${i}5`,
      ean: nextEan(),
      }, { x: 10 * MM, y: 297 * MM - 160 * MM, w: 100 * MM, h: 150 * MM });
    }
    await save("shopee-a4.pdf", doc);
  }

  // 3) Amazon — 6x4 pol. em paisagem (testa rotação automática).
  {
    const { doc, font, bold } = await newDoc();
    const page = doc.addPage([432, 288]);
    drawLabel(page, font, bold, {
      marketplace: "Amazon",
      marker: "LBL-AMZ-1",
      lines: ["Order: 702-1234567-7654321", "amazon.com.br", ...DEST],
      barcode: "TBA123456789012",
      ean: nextEan(),
    }, { x: 0, y: 0, w: 432, h: 288 });
    await save("amazon-4x6-paisagem.pdf", doc);
  }

  // 4) Magazine Luiza — página com /Rotate 90 (conteúdo desenhado deitado).
  {
    const { doc, font, bold } = await newDoc();
    const page = doc.addPage([150 * MM, 100 * MM]);
    drawLabel(page, font, bold, {
      marketplace: "Magalu",
      marker: "LBL-MGL-1",
      lines: ["Magazine Luiza", "Pedido: LU-123456789012", ...DEST],
      barcode: "MGL123456789",
      ean: nextEan(),
    }, { x: 0, y: 0, w: 150 * MM, h: 100 * MM });
    page.setRotation(degrees(90));
    await save("magalu-rotacionada.pdf", doc);
  }

  // 5) TikTok Shop — etiqueta só com imagem (sem texto pesquisável).
  {
    const { doc, bold } = await newDoc();
    const page = doc.addPage([100 * MM, 150 * MM]);
    const png = await doc.embedPng(barcodePng("TTS998877665544"));
    const w = 90 * MM;
    page.drawImage(png, { x: 5 * MM, y: 60 * MM, width: w, height: (w * png.height) / png.width });
    const eanImg = await doc.embedPng(eanPng(nextEan()));
    const ew = 45 * MM;
    page.drawImage(eanImg, { x: 5 * MM, y: 20 * MM, width: ew, height: (ew * eanImg.height) / eanImg.width });
    page.drawRectangle({ x: 4, y: 4, width: 100 * MM - 8, height: 150 * MM - 8, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    void bold;
    await save("tiktok-shop-imagem.pdf", doc);
  }

  // 6) Americanas — 10x10.
  {
    const { doc, font, bold } = await newDoc();
    const page = doc.addPage([100 * MM, 100 * MM]);
    drawLabel(page, font, bold, {
      marketplace: "Americanas",
      marker: "LBL-AME-1",
      lines: ["Pedido: 02-123456789-1", "Rua Exemplo, 123"],
      barcode: "AME0212345678",
      ean: nextEan(),
    }, { x: 0, y: 0, w: 100 * MM, h: 100 * MM });
    await save("americanas-10x10.pdf", doc);
  }

  // 7) Shein + AliExpress compartilhando um rastreio dos Correios (duplicidade por remessa).
  {
    const { doc, font, bold } = await newDoc();
    const page = doc.addPage([100 * MM, 150 * MM]);
    drawLabel(page, font, bold, {
      marketplace: "SHEIN",
      marker: "LBL-SHE-1",
      lines: ["Pedido: GSH1234567890", "Correios: QB123456789BR", ...DEST],
      barcode: "QB123456789BR",
      ean: nextEan(),
    }, { x: 0, y: 0, w: 100 * MM, h: 150 * MM });
    await save("shein.pdf", doc);
  }
  {
    const { doc, font, bold } = await newDoc();
    const page = doc.addPage([100 * MM, 150 * MM]);
    drawLabel(page, font, bold, {
      marketplace: "AliExpress / Cainiao",
      marker: "LBL-ALI-1",
      lines: ["Order: 8123456789012345", "Correios: QB123456789BR", ...DEST],
      barcode: "QB123456789BR",
      ean: nextEan(),
    }, { x: 0, y: 0, w: 100 * MM, h: 150 * MM });
    await save("aliexpress-reenvio.pdf", doc);
  }

  // 8) Cópia idêntica de um arquivo (duplicidade de arquivo).
  copyFileSync(files["mercado-livre-10x15.pdf"], path.join(outDir, "mercado-livre-10x15 (1).pdf"));
  files["mercado-livre-10x15 (1).pdf"] = path.join(outDir, "mercado-livre-10x15 (1).pdf");

  // 9) Arquivos inválidos.
  writeFileSync(path.join(outDir, "corrompido.pdf"), Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog"), Buffer.alloc(200, 0x41)]));
  writeFileSync(path.join(outDir, "nao-e-pdf.pdf"), "Este arquivo é texto, não PDF.");
  files["corrompido.pdf"] = path.join(outDir, "corrompido.pdf");
  files["nao-e-pdf.pdf"] = path.join(outDir, "nao-e-pdf.pdf");

  // 10) PDF protegido com senha de proprietário (se o qpdf estiver instalado).
  const qpdf = spawnSync("qpdf", ["--encrypt", "", "dono123", "256", "--print=none", "--modify=none", "--",
    files["americanas-10x10.pdf"], path.join(outDir, "protegido-americanas.pdf")]);
  if (qpdf.status === 0) files["protegido-americanas.pdf"] = path.join(outDir, "protegido-americanas.pdf");

  writeFileSync(path.join(outDir, "codigos-esperados.json"), JSON.stringify({ ean13: eans }, null, 2));
  return files;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("generate-sample-labels.ts");
if (isMain) {
  const out = path.resolve(process.argv[2] ?? "samples");
  generateSamples(out).then((files) => {
    console.log(`Arquivos de exemplo gerados em ${out}:`);
    for (const name of Object.keys(files)) console.log(" -", name);
  });
}
