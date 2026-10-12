export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(440px,560px)]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#2457f5" />
            <rect x="8" y="6" width="16" height="20" rx="2" fill="#fff" />
            <g fill="#1b2433">
              <rect x="11" y="15" width="1.4" height="7" />
              <rect x="13.4" y="15" width="0.8" height="7" />
              <rect x="15.2" y="15" width="2" height="7" />
              <rect x="18.2" y="15" width="0.8" height="7" />
              <rect x="20" y="15" width="1.4" height="7" />
            </g>
          </svg>
          <span className="text-lg font-semibold">LabelHub Cloud</span>
        </div>

        {/* Ilustração: etiquetas de várias origens caindo em um único rolo. */}
        <div className="relative mx-auto my-10 h-[360px] w-full max-w-[520px]" aria-hidden>
          {[
            { left: "4%", top: "6%", rot: -8, w: 132, h: 190, tag: "Mercado Livre", color: "#e6b800" },
            { left: "34%", top: "0%", rot: 4, w: 150, h: 150, tag: "Shopee", color: "#ee4d2d" },
            { left: "64%", top: "10%", rot: -3, w: 128, h: 186, tag: "Amazon", color: "#ff9900" },
            { left: "18%", top: "46%", rot: 6, w: 140, h: 140, tag: "Magalu", color: "#0086ff" },
            { left: "52%", top: "50%", rot: -6, w: 136, h: 190, tag: "TikTok Shop", color: "#9aa4b2" },
          ].map((s) => (
            <div
              key={s.tag}
              className="absolute rounded-sm bg-white p-3 text-ink shadow-[0_18px_40px_rgba(0,0,0,0.35)]"
              style={{ left: s.left, top: s.top, width: s.w, height: s.h, transform: `rotate(${s.rot}deg)` }}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                {s.tag}
              </div>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-4/5 rounded bg-ink/15" />
                <div className="h-1.5 w-3/5 rounded bg-ink/15" />
                <div className="h-1.5 w-2/3 rounded bg-ink/15" />
              </div>
              <div className="absolute inset-x-3 bottom-3 flex h-10 items-end gap-[2px]">
                {Array.from({ length: 26 }).map((_, i) => (
                  <span key={i} className="h-full bg-ink" style={{ width: [1, 2, 1, 3, 1, 2][i % 6] }} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="max-w-md">
          <p className="text-2xl font-semibold leading-snug">Todas as etiquetas do dia em um único PDF, prontas para a impressora térmica.</p>
          <p className="mt-3 text-white/70">
            Mercado Livre, Shopee, Amazon, Magalu, TikTok Shop, Shein, AliExpress, Americanas e outros — sem abrir arquivo por arquivo.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
