"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { cx } from "../ui";

/**
 * Área de envio com aparência de etiqueta: borda picotada à esquerda e um
 * código de barras desenhado — é o elemento central da tela de unificação.
 */
export function Dropzone({
  onFiles,
  compact,
  disabled,
  maxFileSizeMb,
}: {
  onFiles: (files: File[]) => void;
  compact?: boolean;
  disabled?: boolean;
  maxFileSizeMb: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const pick = () => !disabled && input.current?.click();

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Adicionar arquivos PDF de etiquetas"
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
      className={cx(
        "group relative flex cursor-pointer overflow-hidden rounded-lg border-2 bg-surface transition-colors",
        over ? "border-action bg-action-soft" : "border-dashed border-line-strong hover:border-action/60",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <div className="perforated w-4 shrink-0 bg-ink/[0.04]" aria-hidden />
      <div className={cx("flex flex-1 items-center gap-6", compact ? "px-5 py-4" : "flex-col px-6 py-14 text-center sm:py-16")}>
        {!compact && (
          <div className="flex h-16 items-end gap-[3px]" aria-hidden>
            {[2, 1, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 4, 1, 2, 1, 1, 3, 2].map((w, i) => (
              <span
                key={i}
                className={cx("rounded-[1px] transition-colors", over ? "bg-action" : "bg-ink group-hover:bg-action")}
                style={{ width: w * 2, height: i % 7 === 0 ? 64 : 56 }}
              />
            ))}
          </div>
        )}
        {compact && <FileUp className="size-6 shrink-0 text-action" aria-hidden />}
        <div className={cx(compact ? "text-left" : "max-w-md")}>
          <p className={cx("font-semibold", compact ? "text-[15px]" : "text-xl")}>
            {over ? "Solte para enviar" : compact ? "Adicionar mais PDFs" : "Arraste os PDFs de etiquetas para cá"}
          </p>
          <p className={cx("text-ink-soft", compact ? "text-sm" : "mt-1.5")}>
            {compact
              ? "Arraste ou clique para escolher."
              : `Ou clique para escolher. Pode misturar marketplaces e enviar vários arquivos de uma vez — até ${maxFileSizeMb} MB cada.`}
          </p>
        </div>
        {!compact && (
          <span className="inline-flex h-11 items-center gap-2 rounded-md bg-action px-5 font-medium text-white group-hover:bg-action-dark">
            <FileUp className="size-4" aria-hidden /> Selecionar arquivos
          </span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
