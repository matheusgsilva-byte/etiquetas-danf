/**
 * Regras puras: duplicidades, ordenação, marketplaces, layout e links assinados.
 *   npx tsx --test tests/rules.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectDuplicates } from "../src/lib/duplicates";
import { groupByMarketplace, sortLabels } from "../src/lib/labels";
import { detectMarketplace, extractIdentifiers, shipmentKey } from "../src/lib/marketplaces";
import { normalizeSettings, MM_TO_PT } from "../src/lib/output-settings";
import { effectiveBox, pageGeometry, placeInCell } from "../src/lib/pdf/layout";
import { decodeDownloadToken, encodeDownloadToken } from "../src/lib/storage/signing";

describe("duplicidades", () => {
  const files = [
    { id: "a", sha256: "s1", uploadIndex: 1 },
    { id: "b", sha256: "s2", uploadIndex: 2 },
    { id: "c", sha256: "s1", uploadIndex: 3 }, // cópia de "a"
  ];
  const labels = [
    { id: "a0", fileId: "a", pageIndex: 0, fingerprint: "f1", shipmentKey: "trk:X1", blank: false },
    { id: "a1", fileId: "a", pageIndex: 1, fingerprint: "f2", shipmentKey: null, blank: false },
    { id: "b0", fileId: "b", pageIndex: 0, fingerprint: "f3", shipmentKey: "trk:X1", blank: false },
    { id: "b1", fileId: "b", pageIndex: 1, fingerprint: "f2", shipmentKey: null, blank: false },
    { id: "b2", fileId: "b", pageIndex: 2, fingerprint: "blank", shipmentKey: null, blank: true },
    { id: "b3", fileId: "b", pageIndex: 3, fingerprint: "blank", shipmentKey: "trk:OLD", blank: true },
    { id: "c0", fileId: "c", pageIndex: 0, fingerprint: "f1", shipmentKey: "trk:X1", blank: false },
    { id: "c1", fileId: "c", pageIndex: 1, fingerprint: "f2", shipmentKey: null, blank: false },
  ];

  it("classifica por prioridade e aponta a original", () => {
    const r = detectDuplicates(files, labels, new Set(["trk:OLD"]));
    assert.equal(r.files.get("c"), "a");
    assert.deepEqual(r.labels.get("c0"), { type: "FILE", duplicateOfId: "a0" });
    assert.deepEqual(r.labels.get("c1"), { type: "FILE", duplicateOfId: "a1" });
    assert.deepEqual(r.labels.get("b1"), { type: "PAGE", duplicateOfId: "a1" });
    assert.deepEqual(r.labels.get("b0"), { type: "SHIPMENT", duplicateOfId: "a0" });
    assert.deepEqual(r.labels.get("b3"), { type: "HISTORY", duplicateOfId: null });
    assert.equal(r.labels.has("a0"), false, "a primeira ocorrência nunca é marcada");
    assert.equal(r.labels.has("b2"), false, "páginas em branco não viram duplicidade visual");
  });

  it("a original é sempre a de menor ordem de upload", () => {
    const r = detectDuplicates([...files].reverse(), [...labels].reverse(), new Set());
    assert.equal(r.labels.has("a0"), false);
    assert.equal(r.labels.get("c0")?.type, "FILE");
  });
});

describe("ordenação", () => {
  const base = { pageIndex: 0, importedAt: "2026-10-12T10:00:00Z" };
  const L = [
    { ...base, id: "1", position: 3, marketplace: "shopee", fileName: "lote 10.pdf", uploadIndex: 2, orderId: "B200" },
    { ...base, id: "2", position: 1, marketplace: "amazon", fileName: "lote 9.pdf", uploadIndex: 1, orderId: null },
    { ...base, id: "3", position: 2, marketplace: "mercado_livre", fileName: "Lote 2.pdf", uploadIndex: 3, orderId: "A100" },
  ];
  const ids = (x: { id: string }[]) => x.map((l) => l.id).join("");
  it("ordena por cada critério", () => {
    assert.equal(ids(sortLabels(L, "CUSTOM")), "231");
    assert.equal(ids(sortLabels(L, "UPLOAD")), "213");
    assert.equal(ids(sortLabels(L, "MARKETPLACE")), "231"); // Amazon, Mercado Livre, Shopee
    assert.equal(ids(sortLabels(L, "FILENAME")), "321"); // ordem natural: 2, 9, 10
    assert.equal(ids(sortLabels(L, "ORDER_ID")), "312"); // sem pedido por último
  });
  it("agrupa mantendo a ordem relativa", () => {
    const g = groupByMarketplace([{ marketplace: "a", n: 1 }, { marketplace: "b", n: 2 }, { marketplace: "a", n: 3 }]);
    assert.deepEqual(g.map((x) => [x.marketplace, x.items.map((i) => i.n)]), [["a", [1, 3]], ["b", [2]]]);
  });
});

describe("marketplaces", () => {
  it("texto pesa mais que nome do arquivo", () => {
    assert.equal(detectMarketplace("Shopee Xpress SPX", "mercado-livre.pdf").marketplace, "shopee");
    assert.equal(detectMarketplace("", "etiquetas_shein_0110.pdf").marketplace, "shein");
    assert.equal(detectMarketplace("Remetente: Loja X", "doc.pdf").marketplace, "outros");
  });
  it("DANFE simplificada: chave de acesso e número da nota", () => {
    const t = "UP19FGF26157 DANFE SIMPLIFICADA 1 Saida Série: 009 Número: 491562 Emissao: 09/10/2026 3526 1045 4071 5700 0174 5500 9000 4915 6211 6723 6620 DESTINATÁRIO: Cliente";
    const ids = extractIdentifiers(t, "outros");
    assert.equal(ids.orderId, "NF 491562-009");
    assert.equal(ids.trackingCode, "NFE35261045407157000174550090004915621167236620");
  });
  it("rastreio tem prioridade como chave de remessa", () => {
    const ids = extractIdentifiers("Pedido: 123456789 Objeto: OA123456789BR", "outros");
    assert.equal(ids.trackingCode, "OA123456789BR");
    assert.equal(shipmentKey("outros", ids), "trk:OA123456789BR");
    assert.equal(shipmentKey("amazon", { orderId: "1", trackingCode: null }), "ord:amazon:1");
  });
});

describe("layout", () => {
  const W = 100 * MM_TO_PT;
  const H = 150 * MM_TO_PT;
  const cell = { x: 0, y: 0, width: W, height: H };

  it("etiqueta 10x15 em 10x15: 100%, sem giro", () => {
    const p = placeInCell({ x: 0, y: 0, width: W, height: H }, 0, cell, { scaleMode: "FIT", autoRotate: true });
    assert.equal(p.scale, 1);
    assert.equal(p.rotate, 0);
  });
  it("paisagem em retrato gira 90° e mantém 100% quando cabe", () => {
    const p = placeInCell({ x: 0, y: 0, width: H, height: W }, 0, cell, { scaleMode: "FIT", autoRotate: true });
    assert.equal(p.autoRotated, true);
    assert.equal(p.scale, 1);
    assert.equal(p.rotate, 90);
    // A área desenhada fica dentro da célula.
    assert.ok(p.x - H * 0 <= W + 0.01 && p.x - W * p.scale >= -0.01);
  });
  it("modo FIT nunca amplia; FILL amplia", () => {
    const small = { x: 0, y: 0, width: 50 * MM_TO_PT, height: 75 * MM_TO_PT };
    assert.equal(placeInCell(small, 0, cell, { scaleMode: "FIT", autoRotate: true }).scale, 1);
    assert.ok(Math.abs(placeInCell(small, 0, cell, { scaleMode: "FILL", autoRotate: true }).scale - 2) < 1e-9);
  });
  it("respeita /Rotate da origem", () => {
    // Página 150x100 com /Rotate 90 é exibida 100x150: cabe sem giro extra.
    const p = placeInCell({ x: 0, y: 0, width: H, height: W }, 90, cell, { scaleMode: "FIT", autoRotate: true });
    assert.equal(p.autoRotated, false);
    assert.equal(p.rotate, 270);
    assert.equal(p.scale, 1);
  });
  it("grades A4", () => {
    const g2 = pageGeometry(normalizeSettings({ format: "A4", perSheet: 2 }))!;
    const g4 = pageGeometry(normalizeSettings({ format: "A4", perSheet: 4, marginMm: 3 }))!;
    assert.equal(g2.cells.length, 2);
    assert.equal(g4.cells.length, 4);
    assert.ok(g4.cells[0].y > g4.cells[2].y, "primeira linha fica no topo");
    assert.equal(pageGeometry(normalizeSettings({ format: "ORIGINAL" })), null);
    assert.equal(normalizeSettings({ format: "LABEL_100x150", perSheet: 4 }).perSheet, 1);
  });
  it("só recorta quando há margem relevante", () => {
    const crop = { x: 0, y: 0, width: 100, height: 100 };
    assert.deepEqual(effectiveBox(crop, { x: 2, y: 2, width: 96, height: 96 }, true), crop);
    assert.deepEqual(effectiveBox(crop, { x: 0, y: 50, width: 50, height: 50 }, true), { x: 0, y: 50, width: 50, height: 50 });
    assert.deepEqual(effectiveBox(crop, { x: 0, y: 50, width: 50, height: 50 }, false), crop);
  });
});

describe("links assinados", () => {
  const secret = "x".repeat(40);
  it("valida assinatura e validade", () => {
    const t = encodeDownloadToken({ key: "org/1/a.pdf", exp: Math.floor(Date.now() / 1000) + 60 }, secret);
    assert.equal(decodeDownloadToken(t, secret)?.key, "org/1/a.pdf");
    assert.equal(decodeDownloadToken(t, "y".repeat(40)), null);
    assert.equal(decodeDownloadToken(t.replace(/^./, "A"), secret), null);
    const expired = encodeDownloadToken({ key: "k", exp: Math.floor(Date.now() / 1000) - 1 }, secret);
    assert.equal(decodeDownloadToken(expired, secret), null);
  });
});
