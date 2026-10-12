/**
 * Registro de marketplaces.
 *
 * Para adicionar um novo marketplace basta incluir um item em MARKETPLACES:
 * - `id`: identificador estável (gravado no banco; não renomeie depois de usar).
 * - `detect`: expressões procuradas no texto da etiqueta.
 * - `filename`: expressões procuradas no nome do arquivo (pista secundária).
 * - `orderPatterns`: expressões com um grupo de captura para o nº do pedido.
 * - `trackingPatterns`: expressões com um grupo de captura para o código de rastreio.
 *
 * Este arquivo não depende de Node nem de banco: é usado pelo worker (detecção)
 * e pela interface (nomes e cores).
 */

export type MarketplaceId =
  | "mercado_livre"
  | "shopee"
  | "amazon"
  | "magalu"
  | "tiktok_shop"
  | "shein"
  | "aliexpress"
  | "americanas"
  | "outros";

export interface MarketplaceDefinition {
  id: MarketplaceId;
  name: string;
  /** Cor usada em badges e gráficos (hex). */
  color: string;
  detect: RegExp[];
  filename: RegExp[];
  orderPatterns: RegExp[];
  trackingPatterns: RegExp[];
}

const ORDER_LABEL = String.raw`(?:pedido|order(?:\s*(?:id|sn|no\.?|number))?|n[ºo°]\.?\s*(?:do\s*)?pedido|venda)`;

export const MARKETPLACES: MarketplaceDefinition[] = [
  {
    id: "mercado_livre",
    name: "Mercado Livre",
    color: "#e6b800",
    detect: [/mercado\s*livre/i, /mercadolivre/i, /mercado\s*envios/i, /\bmeli\b/i],
    filename: [/mercado.?livre/i, /\bmeli\b/i, /\bml[_\-\s]/i],
    orderPatterns: [/venda[\s:#nº°]*(\d{10,20})/i, /pack[_\s-]?id[\s:#]*(\d{10,20})/i],
    trackingPatterns: [/envio[\s:#nº°]*(\d{10,12})\b/i],
  },
  {
    id: "shopee",
    name: "Shopee",
    color: "#ee4d2d",
    detect: [/shopee/i, /\bSPX\b/, /shopee\s*xpress/i],
    filename: [/shopee/i, /\bspx\b/i],
    orderPatterns: [new RegExp(ORDER_LABEL + String.raw`[\s:#nº°]*(\d{6}[0-9A-Z]{8})\b`, "i")],
    trackingPatterns: [/\b(BR\d{12,14}[A-Z]?)\b/],
  },
  {
    id: "amazon",
    name: "Amazon",
    color: "#ff9900",
    detect: [/amazon/i],
    filename: [/amazon/i, /\bamz\b/i],
    orderPatterns: [/\b(\d{3}-\d{7}-\d{7})\b/],
    trackingPatterns: [/\b(TB[ACR]\d{9,13})\b/],
  },
  {
    id: "magalu",
    name: "Magazine Luiza",
    color: "#0086ff",
    detect: [/magazine\s*luiza/i, /\bmagalu\b/i],
    filename: [/magalu/i, /magazine.?luiza/i],
    orderPatterns: [new RegExp(ORDER_LABEL + String.raw`[\s:#nº°]*([A-Z]{0,4}-?\d{8,16}(?:-\d{1,2})?)\b`, "i")],
    trackingPatterns: [],
  },
  {
    id: "tiktok_shop",
    name: "TikTok Shop",
    color: "#111111",
    detect: [/tik\s*tok/i],
    filename: [/tik.?tok/i],
    orderPatterns: [new RegExp(ORDER_LABEL + String.raw`[\s:#nº°]*(\d{15,20})\b`, "i")],
    trackingPatterns: [],
  },
  {
    id: "shein",
    name: "Shein",
    color: "#222222",
    detect: [/\bshein\b/i],
    filename: [/shein/i],
    orderPatterns: [new RegExp(ORDER_LABEL + String.raw`[\s:#nº°]*([A-Z]{1,4}[0-9A-Z]{8,20})\b`, "i")],
    trackingPatterns: [],
  },
  {
    id: "aliexpress",
    name: "AliExpress",
    color: "#e62e04",
    detect: [/ali\s*express/i, /cainiao/i],
    filename: [/aliexpress/i, /cainiao/i],
    orderPatterns: [new RegExp(ORDER_LABEL + String.raw`[\s:#nº°]*(\d{14,20})\b`, "i")],
    trackingPatterns: [/\b(LP\d{14,16})\b/],
  },
  {
    id: "americanas",
    name: "Americanas",
    color: "#e60014",
    detect: [/americanas/i, /\bb2w\b/i],
    filename: [/americanas/i, /\bb2w\b/i],
    orderPatterns: [new RegExp(ORDER_LABEL + String.raw`[\s:#nº°]*(\d{2}-?\d{9,12}(?:-\d)?)\b`, "i")],
    trackingPatterns: [],
  },
  {
    id: "outros",
    name: "Outros",
    color: "#64748b",
    detect: [],
    filename: [],
    orderPatterns: [new RegExp(ORDER_LABEL + String.raw`[\s:#nº°]*([A-Z0-9][A-Z0-9-]{5,24})\b`, "i")],
    trackingPatterns: [],
  },
];

/** Padrões de rastreio comuns a qualquer origem (Correios / UPU S10). */
const GENERIC_TRACKING = [/\b([A-Z]{2}\d{9}[A-Z]{2})\b/];

const BY_ID = new Map(MARKETPLACES.map((m) => [m.id, m]));

export function getMarketplace(id: string | null | undefined): MarketplaceDefinition {
  return BY_ID.get(id as MarketplaceId) ?? BY_ID.get("outros")!;
}

export function marketplaceName(id: string | null | undefined) {
  return getMarketplace(id).name;
}

function countMatches(text: string, patterns: RegExp[]) {
  let score = 0;
  for (const p of patterns) {
    const g = new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g");
    const matches = text.match(g);
    if (matches) score += matches.length;
  }
  return score;
}

export interface DetectionResult {
  marketplace: MarketplaceId;
  confidence: "alta" | "media" | "baixa";
}

/**
 * Detecta o marketplace pelo texto da página e, em segundo plano, pelo nome do
 * arquivo. O texto pesa mais que o nome do arquivo.
 */
export function detectMarketplace(text: string, filename = ""): DetectionResult {
  let best: MarketplaceId = "outros";
  let bestScore = 0;
  for (const m of MARKETPLACES) {
    if (m.id === "outros") continue;
    const score = countMatches(text, m.detect) * 3 + countMatches(filename, m.filename) * 2;
    if (score > bestScore) {
      best = m.id;
      bestScore = score;
    }
  }
  const confidence = bestScore >= 3 ? "alta" : bestScore > 0 ? "media" : "baixa";
  return { marketplace: best, confidence };
}

function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return null;
}

export interface Identifiers {
  orderId: string | null;
  trackingCode: string | null;
}

/** Chave de acesso da NF-e (44 dígitos, normalmente em blocos de 4) — identifica a nota de forma única. */
export function extractNfeKey(text: string): string | null {
  const m = text.replace(/\s+/g, " ").match(/\b(\d{4}(?: ?\d{4}){10})\b/);
  if (!m) return null;
  const digits = m[1].replace(/ /g, "");
  return digits.length === 44 ? digits : null;
}

export function extractIdentifiers(text: string, marketplace: MarketplaceId): Identifiers {
  const def = getMarketplace(marketplace);
  const normalized = text.replace(/\s+/g, " ");
  // DANFE / DANFE simplificada: a chave de acesso é a melhor chave de duplicidade,
  // e o número da nota serve como identificador de ordenação.
  if (/\bDANFE\b/i.test(normalized)) {
    const key = extractNfeKey(normalized);
    const nf = normalized.match(/N[úu]mero:?\s*(\d{1,9})/i);
    const serie = normalized.match(/S[ée]rie:?\s*(\d{1,3})/i);
    const ownOrder = firstCapture(normalized, def.orderPatterns);
    return {
      orderId: ownOrder ?? (nf ? `NF ${nf[1]}${serie ? "-" + serie[1] : ""}` : null),
      trackingCode: firstCapture(normalized, def.trackingPatterns) ?? (key ? `NFE${key}` : null),
    };
  }
  const orderId =
    firstCapture(normalized, def.orderPatterns) ??
    (marketplace !== "outros" ? firstCapture(normalized, getMarketplace("outros").orderPatterns) : null);
  const trackingCode = firstCapture(normalized, def.trackingPatterns) ?? firstCapture(normalized, GENERIC_TRACKING);
  return { orderId, trackingCode };
}

/** Chave usada para identificar a mesma remessa em etiquetas diferentes. */
export function shipmentKey(marketplace: string, ids: Identifiers): string | null {
  if (ids.trackingCode) return `trk:${ids.trackingCode}`;
  if (ids.orderId) return `ord:${marketplace}:${ids.orderId}`;
  return null;
}
