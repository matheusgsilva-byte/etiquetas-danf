"use client";

import { OUTPUT_FORMATS, type OutputFormat, type OutputSettings } from "@/lib/output-settings";
import { cx, Toggle } from "../ui";

/** Mini desenho proporcional do papel de cada formato. */
function PaperShape({ format, perSheet }: { format: OutputFormat; perSheet: number }) {
  const dims: Record<OutputFormat, [number, number]> = {
    LABEL_100x150: [20, 30],
    LABEL_100x100: [24, 24],
    A4: [24, 34],
    ORIGINAL: [22, 28],
  };
  const [w, h] = dims[format];
  return (
    <svg width="34" height="38" viewBox="0 0 34 38" aria-hidden className="shrink-0">
      <rect
        x={(34 - w) / 2}
        y={(38 - h) / 2}
        width={w}
        height={h}
        rx="1.5"
        className={format === "ORIGINAL" ? "fill-white stroke-ink-faint" : "fill-white stroke-ink"}
        strokeWidth="1.5"
        strokeDasharray={format === "ORIGINAL" ? "3 2" : undefined}
      />
      {format === "A4" && perSheet > 1 && (
        <g className="stroke-ink-faint" strokeWidth="1" strokeDasharray="2 2">
          <line x1={(34 - w) / 2} y1={19} x2={(34 + w) / 2} y2={19} />
          {perSheet === 4 && <line x1={17} y1={(38 - h) / 2} x2={17} y2={(38 + h) / 2} />}
        </g>
      )}
    </svg>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  locked,
}: {
  settings: OutputSettings;
  onChange: (patch: Partial<OutputSettings>) => void;
  locked: boolean;
}) {
  const isOriginal = settings.format === "ORIGINAL";
  return (
    <fieldset disabled={locked} className="space-y-5">
      <legend className="sr-only">Configurações de impressão</legend>
      <div>
        <p className="mb-2 text-sm font-medium">Formato de saída</p>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(OUTPUT_FORMATS) as OutputFormat[]).map((f) => {
            const active = settings.format === f;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ format: f, perSheet: f === "A4" ? settings.perSheet : 1 })}
                className={cx(
                  "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                  active ? "border-action bg-action-soft" : "border-line hover:border-line-strong",
                )}
              >
                <PaperShape format={f} perSheet={f === "A4" ? settings.perSheet : 1} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{OUTPUT_FORMATS[f].label}</span>
                  <span className="block text-xs leading-tight text-ink-faint">{OUTPUT_FORMATS[f].description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {settings.format === "A4" && (
        <div>
          <p className="mb-2 text-sm font-medium">Etiquetas por folha</p>
          <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Etiquetas por folha">
            {([1, 2, 4] as const).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={settings.perSheet === n}
                onClick={() => onChange({ perSheet: n })}
                className={cx(
                  "h-8 min-w-12 rounded px-3 text-sm font-medium",
                  settings.perSheet === n ? "bg-ink text-white" : "text-ink-soft hover:bg-paper",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isOriginal && (
        <>
          <div>
            <p className="mb-2 text-sm font-medium">Tamanho da etiqueta</p>
            <div className="space-y-2">
              {(
                [
                  ["FIT", "Preservar tamanho real", "Mantém 100% e só reduz se a etiqueta não couber."],
                  ["FILL", "Ajustar ao espaço", "Amplia ou reduz para ocupar a página toda."],
                ] as const
              ).map(([value, title, desc]) => (
                <label
                  key={value}
                  className={cx(
                    "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2",
                    settings.scaleMode === value ? "border-action bg-action-soft" : "border-line hover:border-line-strong",
                  )}
                >
                  <input
                    type="radio"
                    name="scaleMode"
                    className="mt-1 accent-action"
                    checked={settings.scaleMode === value}
                    onChange={() => onChange({ scaleMode: value })}
                  />
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-xs text-ink-faint">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="margin" className="mb-2 block text-sm font-medium">
              Margem
            </label>
            <div className="flex items-center gap-3">
              <input
                id="margin"
                type="range"
                min={0}
                max={10}
                step={0.5}
                value={settings.marginMm}
                onChange={(e) => onChange({ marginMm: Number(e.target.value) })}
                className="flex-1 accent-action"
              />
              <span className="w-14 text-right text-sm tabular-nums">{settings.marginMm.toLocaleString("pt-BR")} mm</span>
            </div>
          </div>

          <div className="space-y-3">
            <Toggle
              checked={settings.autoRotate}
              onChange={(v) => onChange({ autoRotate: v })}
              label="Girar automaticamente"
              description="Deita etiquetas em paisagem para aproveitar o papel."
            />
            <Toggle
              checked={settings.trimWhitespace}
              onChange={(v) => onChange({ trimWhitespace: v })}
              label="Recortar margens em branco"
              description="Útil para etiquetas que vêm em folha A4."
            />
            {settings.format === "A4" && settings.perSheet > 1 && (
              <Toggle checked={settings.cutLines} onChange={(v) => onChange({ cutLines: v })} label="Linhas de corte" />
            )}
          </div>
        </>
      )}

      <div className="space-y-3 border-t border-line pt-4">
        <Toggle
          checked={settings.groupByMarketplace}
          onChange={(v) => onChange({ groupByMarketplace: v, separatorPages: v ? settings.separatorPages : false })}
          label="Separar por marketplace"
          description="Agrupa as etiquetas de cada origem, mantendo a ordem dentro do grupo."
        />
        {settings.groupByMarketplace && (
          <Toggle
            checked={settings.separatorPages}
            onChange={(v) => onChange({ separatorPages: v })}
            label="Página separadora"
            description="Uma página com o nome do marketplace antes de cada grupo."
          />
        )}
      </div>
    </fieldset>
  );
}
