/**
 * Testes do motor de PDF (análise + unificação), sem banco nem fila.
 *   npx tsx --test tests/engine.test.ts
 * Define LABELHUB_TEST_OUT para guardar os PDFs/PNGs gerados.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { generateSamples } from "../scripts/generate-sample-labels";
import { analyzePdf, type FileAnalysis } from "../src/lib/pdf/analyze";
import { composeDocument, validateOutput, type ComposeEntry } from "../src/lib/pdf/compose";
import { PdfInputError } from "../src/lib/pdf/load";
import { openWithPdfJs } from "../src/lib/pdf/pdfjs";
import { groupByMarketplace } from "../src/lib/labels";
import { marketplaceName } from "../src/lib/marketplaces";
import { normalizeSettings, MM_TO_PT, type OutputSettings } from "../src/lib/output-settings";

const OUT = process.env.LABELHUB_TEST_OUT ?? path.join(os.tmpdir(), "labelhub-engine-test");
const SAMPLES = path.join(OUT, "samples");
let files: Record<string, string> = {};
const analyses = new Map<string, FileAnalysis>();

const VALID = [
  "mercado-livre-10x15.pdf",
  "shopee-a4.pdf",
  "amazon-4x6-paisagem.pdf",
  "magalu-rotacionada.pdf",
  "tiktok-shop-imagem.pdf",
  "americanas-10x10.pdf",
  "shein.pdf",
  "aliexpress-reenvio.pdf",
];

async function pageTexts(bytes: Uint8Array) {
  const pdf = await openWithPdfJs(bytes);
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const tc = await p.getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  await pdf.close();
  return out;
}

async function renderPng(bytes: Uint8Array, dpi: number, prefix: string) {
  const pdf = await openWithPdfJs(bytes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory = (pdf as any).canvasFactory;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: dpi / 72 });
    const { canvas, context } = factory.create(Math.ceil(vp.width), Math.ceil(vp.height));
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport: vp }).promise;
    writeFileSync(`${prefix}-p${i}.png`, await canvas.encode("png"));
  }
  await pdf.close();
}

function entriesFor(names: string[], settings: OutputSettings): ComposeEntry[] {
  const labels = names.flatMap((name) =>
    analyses.get(name)!.pages.map((p) => ({
      marketplace: p.marketplace,
      entry: {
        kind: "label" as const,
        ref: `${name}#${p.index + 1}`,
        sourceId: name,
        pageIndex: p.index,
        cropBox: p.cropBox,
        contentBox: p.contentBox,
        rotation: p.rotation,
      },
    })),
  );
  if (!settings.groupByMarketplace) return labels.map((l) => l.entry);
  return groupByMarketplace(labels).flatMap((g) => [
    ...(settings.separatorPages
      ? [{ kind: "separator" as const, title: marketplaceName(g.marketplace), subtitle: `${g.items.length} etiqueta(s)` }]
      : []),
    ...g.items.map((i) => i.entry),
  ]);
}

const sourceCache = new Map<string, PDFDocument>();
async function loadSource(name: string) {
  if (!sourceCache.has(name)) sourceCache.set(name, await PDFDocument.load(readFileSync(files[name])));
  return sourceCache.get(name)!;
}

describe("motor de PDF", () => {
  before(async () => {
    mkdirSync(OUT, { recursive: true });
    files = await generateSamples(SAMPLES);
    for (const name of [...VALID, "protegido-americanas.pdf"]) {
      if (!files[name]) continue;
      analyses.set(name, await analyzePdf(readFileSync(files[name]), name));
    }
  });

  it("detecta marketplace, pedido e rastreio", () => {
    const expect: Record<string, { mp: string; pages: number; order?: string; tracking?: string }> = {
      "mercado-livre-10x15.pdf": { mp: "mercado_livre", pages: 3, order: "2000007000001" },
      "shopee-a4.pdf": { mp: "shopee", pages: 2, order: "2410121ABCDEFG", tracking: "BR260000000015" },
      "amazon-4x6-paisagem.pdf": { mp: "amazon", pages: 1, order: "702-1234567-7654321", tracking: "TBA123456789012" },
      "magalu-rotacionada.pdf": { mp: "magalu", pages: 1, order: "LU-123456789012" },
      "tiktok-shop-imagem.pdf": { mp: "tiktok_shop", pages: 1 },
      "americanas-10x10.pdf": { mp: "americanas", pages: 1, order: "02-123456789-1" },
      "shein.pdf": { mp: "shein", pages: 1, tracking: "QB123456789BR" },
      "aliexpress-reenvio.pdf": { mp: "aliexpress", pages: 1, order: "8123456789012345", tracking: "QB123456789BR" },
    };
    for (const [name, e] of Object.entries(expect)) {
      const a = analyses.get(name)!;
      assert.equal(a.pageCount, e.pages, name);
      assert.equal(a.marketplace, e.mp, name);
      if (e.order) assert.equal(a.pages[0].orderId, e.order, `${name} pedido`);
      if (e.tracking) assert.equal(a.pages[0].trackingCode, e.tracking, `${name} rastreio`);
      assert.ok(a.pages.every((p) => p.thumbnail && p.thumbnail.length > 500), `${name} miniatura`);
    }
  });

  it("mede tamanho, rotação e área de conteúdo", () => {
    const ml = analyses.get("mercado-livre-10x15.pdf")!.pages[0];
    assert.ok(Math.abs(ml.widthPt - 100 * MM_TO_PT) < 0.5 && Math.abs(ml.heightPt - 150 * MM_TO_PT) < 0.5);
    const mg = analyses.get("magalu-rotacionada.pdf")!.pages[0];
    assert.equal(mg.rotation, 90);
    assert.ok(Math.abs(mg.widthPt - 100 * MM_TO_PT) < 0.5, "página rotacionada é exibida em retrato");
    const sp = analyses.get("shopee-a4.pdf")!.pages[0];
    assert.ok(sp.contentBox, "conteúdo detectado");
    assert.ok(sp.contentBox!.width < 120 * MM_TO_PT && sp.contentBox!.height < 165 * MM_TO_PT, "recorte da A4");
  });

  it("identifica duplicidades visuais e de remessa", () => {
    const original = analyses.get("americanas-10x10.pdf")!.pages[0].fingerprint;
    const prot = analyses.get("protegido-americanas.pdf");
    if (prot) assert.equal(prot.pages[0].fingerprint, original, "PDF protegido normalizado tem a mesma impressão digital");
    const ml = analyses.get("mercado-livre-10x15.pdf")!.pages;
    assert.notEqual(ml[0].fingerprint, ml[1].fingerprint, "etiquetas diferentes não colidem");
    assert.equal(
      analyses.get("shein.pdf")!.pages[0].trackingCode,
      analyses.get("aliexpress-reenvio.pdf")!.pages[0].trackingCode,
    );
  });

  it("rejeita arquivos inválidos com mensagem clara", async () => {
    await assert.rejects(analyzePdf(readFileSync(files["nao-e-pdf.pdf"]), "x.pdf"), (e: unknown) => e instanceof PdfInputError && e.code === "NOT_PDF");
    await assert.rejects(analyzePdf(readFileSync(files["corrompido.pdf"]), "x.pdf"), (e: unknown) => e instanceof PdfInputError && e.code === "CORRUPTED");
  });

  it("abre PDF protegido por senha de proprietário", () => {
    const prot = analyses.get("protegido-americanas.pdf");
    if (!prot) return; // qpdf ausente
    assert.equal(prot.repaired, true);
    assert.equal(prot.pageCount, 1);
  });

  const scenarios: { name: string; settings: Partial<OutputSettings>; size?: [number, number] }[] = [
    { name: "original", settings: { format: "ORIGINAL" } },
    { name: "10x15", settings: { format: "LABEL_100x150" }, size: [100, 150] },
    { name: "10x10", settings: { format: "LABEL_100x100" }, size: [100, 100] },
    { name: "a4-4", settings: { format: "A4", perSheet: 4, cutLines: true }, size: [210, 297] },
    { name: "a4-2", settings: { format: "A4", perSheet: 2 }, size: [210, 297] },
    { name: "10x15-agrupado", settings: { format: "LABEL_100x150", groupByMarketplace: true, separatorPages: true, marginMm: 2 }, size: [100, 150] },
  ];

  for (const sc of scenarios) {
    it(`unifica no formato ${sc.name} preservando a ordem`, async () => {
      const settings = normalizeSettings(sc.settings);
      const entries = entriesFor(VALID, settings);
      let lastProgress = 0;
      const result = await composeDocument(entries, {
        settings,
        loadSource,
        onProgress: (d) => {
          lastProgress = d;
        },
      });
      assert.equal(lastProgress, entries.length);
      await validateOutput(result.bytes, result);
      const labels = entries.filter((e) => e.kind === "label").length;
      assert.equal(result.labelCount, labels);
      const perPage = settings.format === "A4" ? settings.perSheet : 1;
      if (!settings.groupByMarketplace) assert.equal(result.pageCount, Math.ceil(labels / perPage));

      if (sc.size) {
        const doc = await PDFDocument.load(result.bytes);
        for (const page of doc.getPages()) {
          const { width, height } = page.getSize();
          assert.ok(Math.abs(width - sc.size[0] * MM_TO_PT) < 0.5 && Math.abs(height - sc.size[1] * MM_TO_PT) < 0.5);
        }
      }

      // Ordem: os marcadores LBL-* devem aparecer na mesma sequência da entrada.
      const expected = entries.flatMap((e) => {
        if (e.kind !== "label") return [];
        const a = analyses.get(e.sourceId)!.pages[e.pageIndex];
        const m = a.text.match(/LBL-[A-Z]+-\d+/);
        return m ? [m[0]] : [];
      });
      const found = (await pageTexts(result.bytes)).join(" ").match(/LBL-[A-Z]+-\d+/g) ?? [];
      assert.deepEqual(found, expected);

      writeFileSync(path.join(OUT, `saida-${sc.name}.pdf`), result.bytes);
      if (process.env.LABELHUB_RENDER) await renderPng(result.bytes, 203, path.join(OUT, `saida-${sc.name}`));
      if (result.warnings.length) console.log(`  [${sc.name}] avisos:`, result.warnings.map((w) => w.ref).join(", "));
    });
  }
});
