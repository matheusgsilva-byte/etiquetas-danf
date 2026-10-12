/**
 * Ordenação e agrupamento de etiquetas. Compartilhado entre interface e worker.
 */
import { marketplaceName } from "./marketplaces";
import type { SortMode } from "./output-settings";

export interface SortableLabel {
  id: string;
  position: number;
  marketplace: string;
  fileName: string;
  uploadIndex: number;
  pageIndex: number;
  orderId: string | null;
  importedAt: string | Date;
}

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function byUpload(a: SortableLabel, b: SortableLabel) {
  return a.uploadIndex - b.uploadIndex || a.pageIndex - b.pageIndex;
}

export function sortLabels<T extends SortableLabel>(labels: T[], mode: SortMode): T[] {
  const list = [...labels];
  switch (mode) {
    case "CUSTOM":
      return list.sort((a, b) => a.position - b.position || byUpload(a, b));
    case "UPLOAD":
      return list.sort(byUpload);
    case "MARKETPLACE":
      return list.sort(
        (a, b) => collator.compare(marketplaceName(a.marketplace), marketplaceName(b.marketplace)) || byUpload(a, b),
      );
    case "FILENAME":
      return list.sort((a, b) => collator.compare(a.fileName, b.fileName) || a.pageIndex - b.pageIndex || byUpload(a, b));
    case "ORDER_ID":
      return list.sort((a, b) => {
        if (a.orderId && b.orderId) return collator.compare(a.orderId, b.orderId) || byUpload(a, b);
        if (a.orderId) return -1;
        if (b.orderId) return 1;
        return byUpload(a, b);
      });
    case "IMPORTED_AT":
      return list.sort(
        (a, b) => new Date(a.importedAt).getTime() - new Date(b.importedAt).getTime() || byUpload(a, b),
      );
    default:
      return list;
  }
}

/** Agrupa mantendo a ordem relativa; os grupos seguem a ordem de primeira aparição. */
export function groupByMarketplace<T extends { marketplace: string }>(labels: T[]) {
  const groups = new Map<string, T[]>();
  for (const l of labels) {
    const g = groups.get(l.marketplace);
    if (g) g.push(l);
    else groups.set(l.marketplace, [l]);
  }
  return [...groups.entries()].map(([marketplace, items]) => ({ marketplace, items }));
}
