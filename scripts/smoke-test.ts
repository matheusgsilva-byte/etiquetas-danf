/**
 * Teste de ponta a ponta contra uma instância em execução (web + worker).
 *
 *   npm run smoke                       # usa http://localhost:3000
 *   APP_URL=https://seu-dominio npm run smoke
 *
 * Cria duas contas de teste, envia os PDFs de exemplo, confere análise,
 * duplicidades, ordem, geração, download, validação do PDF final e o
 * isolamento entre empresas. Os dados de teste ficam na base (exclua as
 * empresas "Smoke ..." depois, pela tela Conta, se quiser).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { generateSamples } from "./generate-sample-labels";
import { openWithPdfJs } from "../src/lib/pdf/pdfjs";

const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SAMPLES = path.resolve("samples");

class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown, raw?: BodyInit) {
    const res = await fetch(BASE + url, {
      method,
      redirect: "manual",
      headers: {
        Cookie: this.cookie,
        Origin: BASE,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get("set-cookie");
    if (set?.includes("lh_session=")) this.cookie = set.split(";")[0];
    return res;
  }
  async json<T = any>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await this.req(method, url, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(`${method} ${url} → ${res.status}: ${data.error}`), { status: res.status, data });
    return data as T;
  }
}

const step = (msg: string) => console.log(`✔ ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function register(name: string) {
  const c = new Client();
  const email = `smoke+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;
  await c.json("POST", "/api/auth/register", { name: "Teste", company: name, email, password: "Senha12345", acceptTerms: true });
  return c;
}

async function main() {
  if (!existsSync(SAMPLES) || readdirSync(SAMPLES).length < 5) await generateSamples(SAMPLES);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  assert.equal(health.ok, true, `Serviço indisponível: ${JSON.stringify(health)}`);
  step("health: banco e Redis ok");

  const a = await register("Smoke A");
  const b = await register("Smoke B");
  step("contas criadas");

  const { batch } = await a.json("POST", "/api/batches", { name: "Smoke - lote" });
  const names = [
    "mercado-livre-10x15.pdf", "shopee-a4.pdf", "amazon-4x6-paisagem.pdf", "magalu-rotacionada.pdf",
    "tiktok-shop-imagem.pdf", "americanas-10x10.pdf", "shein.pdf", "aliexpress-reenvio.pdf",
    "mercado-livre-10x15 (1).pdf", "corrompido.pdf",
  ];
  for (const n of names) {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(path.join(SAMPLES, n))], { type: "application/pdf" }), n);
    const res = await a.req("POST", `/api/batches/${batch.id}/files`, undefined, form);
    assert.equal(res.status, 201, `upload de ${n}: ${res.status}`);
  }
  const notPdf = new FormData();
  notPdf.append("file", new Blob([readFileSync(path.join(SAMPLES, "nao-e-pdf.pdf"))]), "nao-e-pdf.pdf");
  assert.equal((await a.req("POST", `/api/batches/${batch.id}/files`, undefined, notPdf)).status, 415);
  step(`${names.length} PDFs enviados; arquivo que não é PDF recusado`);

  let detail: any;
  for (let i = 0; i < 120; i++) {
    detail = await a.json("GET", `/api/batches/${batch.id}`);
    if (detail.files.every((f: any) => f.status === "READY" || f.status === "ERROR")) break;
    await sleep(1000);
  }
  const errors = detail.files.filter((f: any) => f.status === "ERROR").map((f: any) => f.name);
  assert.deepEqual(errors, ["corrompido.pdf"], "apenas o arquivo corrompido deve falhar");
  assert.equal(detail.labels.length, 14);
  step(`análise concluída: ${detail.labels.length} etiquetas, erro claro no arquivo corrompido`);

  const dups = detail.labels.filter((l: any) => l.duplicateType);
  assert.ok(dups.some((l: any) => l.duplicateType === "FILE"), "arquivo repetido detectado");
  assert.ok(dups.some((l: any) => l.duplicateType === "SHIPMENT"), "remessa repetida detectada");
  assert.ok(dups.every((l: any) => !l.excluded), "nada é excluído automaticamente");
  step(`duplicidades marcadas para revisão: ${dups.length}`);

  const pending = await a.req("POST", `/api/batches/${batch.id}/generate`, { settings: { format: "LABEL_100x150" } });
  assert.equal(pending.status, 409, "geração deve pedir confirmação das duplicidades");
  await a.json("PATCH", `/api/batches/${batch.id}/labels`, { bulk: "REMOVE_PENDING_DUPLICATES" });
  step("duplicidades removidas por decisão explícita");

  // Inverte a ordem para provar que a ordem escolhida é respeitada.
  const order = [...detail.labels].reverse().map((l: any) => l.id);
  await a.json("PATCH", `/api/batches/${batch.id}/labels`, { order, sort: "CUSTOM" });
  const { job } = await a.json("POST", `/api/batches/${batch.id}/generate`, { settings: { format: "LABEL_100x150", sort: "CUSTOM" } });
  let result: any;
  for (let i = 0; i < 180; i++) {
    result = (await a.json("GET", `/api/jobs/${job.id}`)).job;
    if (result.status === "COMPLETED" || result.status === "FAILED") break;
    await sleep(1000);
  }
  assert.equal(result.status, "COMPLETED", result.error);
  step(`PDF gerado: ${result.labelsIncluded} etiquetas, ${result.pageCount} páginas, ${result.labelsDiscarded} descartadas`);

  const redirect = await a.req("GET", `/api/jobs/${job.id}/download`);
  assert.equal(redirect.status, 302);
  const signed = redirect.headers.get("location")!;
  const pdfRes = await fetch(signed.startsWith("http") ? signed : BASE + signed);
  assert.equal(pdfRes.status, 200);
  const bytes = new Uint8Array(await pdfRes.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), result.pageCount);
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    assert.ok(Math.abs(width - 283.46) < 0.5 && Math.abs(height - 425.2) < 0.5, "páginas 10x15");
  }
  const pdf = await openWithPdfJs(bytes);
  const markers: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    const m = tc.items.map((it: any) => it.str ?? "").join(" ").match(/LBL-[A-Z]+-\d+/);
    if (m) markers.push(m[0]);
  }
  await pdf.close();
  const kept = detail.labels.filter((l: any) => !dups.some((d: any) => d.id === l.id));
  const keptOrder = order.filter((id) => kept.some((l: any) => l.id === id));
  const MARKER: Record<string, string> = {
    "mercado-livre-10x15.pdf": "LBL-ML-", "shopee-a4.pdf": "LBL-SP-", "amazon-4x6-paisagem.pdf": "LBL-AMZ-",
    "magalu-rotacionada.pdf": "LBL-MGL-", "americanas-10x10.pdf": "LBL-AME-", "shein.pdf": "LBL-SHE-", "aliexpress-reenvio.pdf": "LBL-ALI-",
  };
  const expected = keptOrder
    .map((id) => kept.find((l: any) => l.id === id))
    .filter((l: any) => MARKER[l.fileName]) // a etiqueta do TikTok é só imagem (sem texto)
    .map((l: any) => MARKER[l.fileName] + (l.pageIndex + 1));
  assert.deepEqual(markers, expected, "ordem do PDF igual à ordem escolhida");
  step(`download por link temporário ok; PDF válido, 10x15 cm, ordem preservada (${markers.join(" ")})`);

  // Isolamento entre empresas.
  for (const url of [`/api/batches/${batch.id}`, `/api/jobs/${job.id}`, `/api/jobs/${job.id}/download`]) {
    const res = await b.req("GET", url);
    assert.equal(res.status, 404, `outra empresa não pode acessar ${url}`);
  }
  step("isolamento entre empresas confirmado");

  const history = await a.json("GET", "/api/jobs?status=COMPLETED");
  assert.ok(history.jobs.some((j: any) => j.id === job.id));
  const dash = await a.json("GET", "/api/dashboard?days=7");
  assert.ok(dash.totals.labelsPrinted >= result.labelsIncluded);
  step("histórico e dashboard registraram a operação");

  console.log("\nTodos os testes de ponta a ponta passaram.");
}

main().catch((err) => {
  console.error("✘", err.message);
  process.exit(1);
});
