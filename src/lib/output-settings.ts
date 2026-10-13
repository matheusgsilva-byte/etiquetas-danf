/**
 * Configurações de saída do PDF unificado. Compartilhado entre interface,
 * API e worker (não importa nada específico de Node).
 */
import { z } from "zod";

export const MM_TO_PT = 72 / 25.4;

export const OUTPUT_FORMATS = {
  ORIGINAL: { label: "Original", description: "Sem alterar a página", widthMm: 0, heightMm: 0 },
  LABEL_100x150: { label: "10 × 15 cm", description: "Térmica", widthMm: 100, heightMm: 150 },
  LABEL_100x100: { label: "10 × 10 cm", description: "Térmica", widthMm: 100, heightMm: 100 },
  A4: { label: "A4", description: "Folha comum", widthMm: 210, heightMm: 297 },
} as const;

export type OutputFormat = keyof typeof OUTPUT_FORMATS;

export const SORT_MODES = {
  CUSTOM: "Ordem personalizada",
  UPLOAD: "Ordem de upload",
  MARKETPLACE: "Marketplace",
  FILENAME: "Nome do arquivo",
  ORDER_ID: "Número do pedido",
  SKU: "SKU",
  IMPORTED_AT: "Data de importação",
} as const;

export type SortMode = keyof typeof SORT_MODES;

export const outputSettingsSchema = z.object({
  format: z.enum(["ORIGINAL", "LABEL_100x150", "LABEL_100x100", "A4"]).default("LABEL_100x150"),
  /** FIT: mantém 100% quando cabe e só reduz se necessário. FILL: ajusta ao espaço disponível (pode ampliar). */
  scaleMode: z.enum(["FIT", "FILL"]).default("FIT"),
  autoRotate: z.boolean().default(true),
  /** Recorta margens em branco ao redor da etiqueta (não vale para "Tamanho original"). */
  trimWhitespace: z.boolean().default(true),
  marginMm: z.number().min(0).max(20).default(0),
  /** Etiquetas por folha — só para A4. */
  perSheet: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  cutLines: z.boolean().default(true),
  groupByMarketplace: z.boolean().default(false),
  separatorPages: z.boolean().default(false),
  sort: z.enum(["CUSTOM", "UPLOAD", "MARKETPLACE", "FILENAME", "ORDER_ID", "SKU", "IMPORTED_AT"]).default("UPLOAD"),
});

export type OutputSettings = z.infer<typeof outputSettingsSchema>;

export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = outputSettingsSchema.parse({});

export function normalizeSettings(input: unknown): OutputSettings {
  const parsed = outputSettingsSchema.safeParse(input ?? {});
  const s = parsed.success ? parsed.data : DEFAULT_OUTPUT_SETTINGS;
  // Múltiplas etiquetas por folha só fazem sentido em A4.
  if (s.format !== "A4") s.perSheet = 1;
  if (!s.groupByMarketplace) s.separatorPages = false;
  return s;
}

/** Abaixo desta escala o sistema alerta sobre possível perda de legibilidade. */
export const MIN_READABLE_SCALE = 0.8;

export function describeSettings(s: OutputSettings) {
  const parts: string[] = [s.format === "ORIGINAL" ? "Tamanho original" : OUTPUT_FORMATS[s.format].label];
  if (s.format === "A4" && s.perSheet > 1) parts.push(`${s.perSheet} por folha`);
  if (s.format !== "ORIGINAL") {
    parts.push(s.scaleMode === "FIT" ? "tamanho real" : "ajustar à página");
    if (s.marginMm) parts.push(`margem ${s.marginMm} mm`);
  }
  if (s.groupByMarketplace) parts.push("separado por marketplace");
  return parts.join(" · ");
}
