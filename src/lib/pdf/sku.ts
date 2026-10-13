/**
 * Extração do SKU impresso na etiqueta/DANFE.
 *
 * 1. Tabela com cabeçalho "SKU" (ex.: DANFE simplificada): lê a coluna SKU pela
 *    posição do texto e remonta as linhas quebradas. O texto quebra no meio da
 *    palavra quando ela não cabe na coluna (AMAMENT|AÇÃO) e entre palavras nos
 *    demais casos (BOJO COR|ÚNICA), então a junção segue essa regra.
 * 2. Sem tabela: procura "SKU: XXXX" no texto corrido.
 *
 * Com mais de um item na etiqueta, os SKUs vêm separados por " | " (o primeiro
 * é usado para ordenar).
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function joinWrapped(lines: TextItem[], columnWidth: number): string {
  let out = "";
  let prev: TextItem | null = null;
  for (const line of lines) {
    const text = line.str.trim();
    if (!text) continue;
    if (!prev) {
      out = text;
    } else {
      const p = prev.str.trim();
      const brokeMidWord = p.endsWith("-") || (!/\s/.test(p) && prev.width >= columnWidth * 0.8);
      out += brokeMidWord ? text : ` ${text}`;
    }
    prev = line;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Alguns PDFs juntam o SKU e a descrição num mesmo trecho de texto
 * ("kit1sutiãinfantil 1 Sutiã Top..."): fica só a parte dentro da coluna.
 */
function clipToColumn(item: TextItem, columnEnd: number): TextItem {
  if (item.x + item.width <= columnEnd + 2) return item;
  const text = item.str.trim();
  const charW = item.width / Math.max(1, text.length);
  const fits = Math.max(1, Math.floor((columnEnd - item.x) / charW));
  const firstToken = text.split(/\s+/)[0];
  // A largura por caractere é só uma estimativa (fonte proporcional): tolerância de 50%.
  const clipped = firstToken.length <= Math.ceil(fits * 1.5) ? firstToken : text.slice(0, fits);
  return { ...item, str: clipped, width: clipped.length * charW };
}

function fromTable(items: TextItem[]): string[] | null {
  const header = items.find((i) => norm(i.str) === "sku");
  if (!header) return null;
  const sameRow = (i: TextItem) => Math.abs(i.y - header.y) < 3 && i !== header;
  // Próxima coluna à direita do SKU (normalmente "Descrição").
  const right = items.filter((i) => sameRow(i) && i.x > header.x).sort((a, b) => a.x - b.x);
  const nextX = right[0]?.x ?? header.x + 120;
  const qtyHeader = right.find((i) => /^(qtd|qtde|quant|quantidade)/.test(norm(i.str)));
  const columnWidth = nextX - header.x;

  // Fim da tabela: "Total" abaixo do cabeçalho, ou o fim da página.
  const total = items
    .filter((i) => i.y < header.y - 2 && /^total/.test(norm(i.str)) && Math.abs(i.x - header.x) < 10)
    .sort((a, b) => b.y - a.y)[0];
  const bottom = total ? total.y + 2 : -Infinity;

  const inColumn = items
    .filter((i) => i.y < header.y - 2 && i.y > bottom && i.x >= header.x - 3 && i.x < nextX - 2 && i.str.trim())
    .map((i) => clipToColumn(i, nextX))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  if (!inColumn.length) return null;

  // Início de cada item da tabela: as linhas da coluna QTD (ou, sem ela, uma linha só).
  let rowStarts: number[] = [];
  if (qtyHeader) {
    rowStarts = items
      .filter((i) => i.y < header.y - 2 && i.y > bottom && Math.abs(i.x - qtyHeader.x) < 15 && /^\d+([.,]\d+)?$/.test(i.str.trim()))
      .map((i) => i.y)
      .sort((a, b) => b - a);
  }
  if (!rowStarts.length) rowStarts = [inColumn[0].y];

  const rows: TextItem[][] = rowStarts.map(() => []);
  for (const it of inColumn) {
    // Pertence ao último início de item que está na mesma altura ou acima dele.
    let idx = 0;
    for (let r = 0; r < rowStarts.length; r++) if (rowStarts[r] >= it.y - 1.5) idx = r;
    rows[idx].push(it);
  }
  const skus = rows.map((r) => joinWrapped(r, columnWidth)).filter(Boolean);
  return skus.length ? skus : null;
}

function fromInline(text: string): string[] | null {
  const found: string[] = [];
  const re = /\bSKU\s*[:#-]?\s*([A-Za-z0-9][\w./-]{1,59})/gi;
  for (const m of text.matchAll(re)) {
    const v = m[1];
    if (/^(descri|varia|qtd|quant)/i.test(norm(v))) continue;
    if (!found.includes(v)) found.push(v);
  }
  return found.length ? found : null;
}

export function extractSku(items: TextItem[], fullText: string): string | null {
  const skus = fromTable(items) ?? fromInline(fullText);
  if (!skus) return null;
  return skus.join(" | ").slice(0, 300);
}

/** Chave de ordenação: sem acentos, maiúsculas e sem espaços (as quebras de linha não interferem). */
export function skuSortKey(sku: string | null | undefined): string | null {
  if (!sku) return null;
  return sku.split(" | ")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toUpperCase();
}
