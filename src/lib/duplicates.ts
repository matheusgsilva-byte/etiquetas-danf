/**
 * Regras de detecção de duplicidades (função pura, testável).
 *
 * Tipos, em ordem de prioridade:
 *  - FILE:     o arquivo inteiro é idêntico (mesmo SHA-256) a outro do lote.
 *  - PAGE:     a página é visualmente idêntica a outra do lote.
 *  - SHIPMENT: mesma chave de DANFE, mesmo código de rastreio (ou mesmo nº de
 *              pedido no mesmo marketplace).
 *  - HISTORY:  a mesma DANFE/remessa já saiu em um PDF gerado anteriormente pela empresa.
 *
 * A primeira ocorrência (ordem de upload) é considerada a original. Nada é
 * removido automaticamente: o resultado apenas marca as etiquetas para revisão.
 */
export type DuplicateType = "FILE" | "PAGE" | "SHIPMENT" | "HISTORY";

export interface DupFile {
  id: string;
  sha256: string;
  uploadIndex: number;
}

export interface DupLabel {
  id: string;
  fileId: string;
  pageIndex: number;
  fingerprint: string | null;
  shipmentKey: string | null;
  blank: boolean;
}

export interface DupResult {
  labels: Map<string, { type: DuplicateType; duplicateOfId: string | null; note?: string }>;
  files: Map<string, string>; // fileId -> fileId original
}

/** Chave da DANFE (prefixo "nfe:" na chave de remessa). */
export const isNfeKey = (key: string | null | undefined) => !!key && key.startsWith("nfe:");

/**
 * historyKeys: chaves já impressas antes; no formato Map, o valor é o texto
 * explicativo mostrado ao usuário (ex.: data da impressão anterior).
 */
export function detectDuplicates(
  files: DupFile[],
  labels: DupLabel[],
  historyKeys: Set<string> | Map<string, string>,
): DupResult {
  const result: DupResult = { labels: new Map(), files: new Map() };
  const fileOrder = new Map(files.map((f) => [f.id, f.uploadIndex]));

  const firstBySha = new Map<string, string>();
  for (const f of [...files].sort((a, b) => a.uploadIndex - b.uploadIndex)) {
    const original = firstBySha.get(f.sha256);
    if (original) result.files.set(f.id, original);
    else firstBySha.set(f.sha256, f.id);
  }

  const sorted = [...labels].sort(
    (a, b) => (fileOrder.get(a.fileId) ?? 0) - (fileOrder.get(b.fileId) ?? 0) || a.pageIndex - b.pageIndex,
  );
  const byFilePage = new Map(sorted.map((l) => [`${l.fileId}#${l.pageIndex}`, l.id]));
  const seenFingerprint = new Map<string, string>();
  const seenShipment = new Map<string, string>();

  for (const l of sorted) {
    const originalFile = result.files.get(l.fileId);
    if (originalFile) {
      result.labels.set(l.id, { type: "FILE", duplicateOfId: byFilePage.get(`${originalFile}#${l.pageIndex}`) ?? null });
      continue;
    }
    if (l.fingerprint && !l.blank) {
      const first = seenFingerprint.get(l.fingerprint);
      if (first) {
        result.labels.set(l.id, { type: "PAGE", duplicateOfId: first });
        continue;
      }
      seenFingerprint.set(l.fingerprint, l.id);
    }
    if (l.shipmentKey) {
      const first = seenShipment.get(l.shipmentKey);
      if (first) {
        result.labels.set(l.id, {
          type: "SHIPMENT",
          duplicateOfId: first,
          ...(isNfeKey(l.shipmentKey) ? { note: "Mesma chave de DANFE de outra etiqueta deste lote." } : {}),
        });
        continue;
      }
      seenShipment.set(l.shipmentKey, l.id);
      if (historyKeys.has(l.shipmentKey)) {
        const note = historyKeys instanceof Map ? historyKeys.get(l.shipmentKey) : undefined;
        result.labels.set(l.id, { type: "HISTORY", duplicateOfId: null, ...(note ? { note } : {}) });
      }
    }
  }
  return result;
}

export const DUPLICATE_LABELS: Record<DuplicateType, string> = {
  FILE: "Arquivo repetido",
  PAGE: "Etiqueta idêntica",
  SHIPMENT: "Mesma remessa",
  HISTORY: "Já impressa antes",
};

export const DUPLICATE_HELP: Record<DuplicateType, string> = {
  FILE: "O mesmo arquivo foi enviado mais de uma vez neste lote.",
  PAGE: "Esta página é visualmente idêntica a outra etiqueta do lote.",
  SHIPMENT: "Outra etiqueta do lote tem a mesma chave de DANFE, código de rastreio ou número de pedido.",
  HISTORY: "Esta DANFE (mesma chave de acesso) ou remessa já saiu em um PDF unificado gerado anteriormente.",
};
