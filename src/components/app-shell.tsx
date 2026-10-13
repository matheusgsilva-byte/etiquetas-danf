"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FilePlus2, History, LayoutDashboard, LogOut, Menu, Settings, UserRound, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { cx, ToastProvider } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/unificar", label: "Nova unificação", icon: FilePlus2 },
  { href: "/historico", label: "Histórico", icon: History },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
  { href: "/conta", label: "Conta", icon: UserRound },
];

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 text-white">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
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
      <span className="text-[17px] font-semibold tracking-tight">LabelHub</span>
    </Link>
  );
}

export function AppShell({
  user,
  orgName,
  children,
}: {
  user: { name: string; email: string };
  orgName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  async function logout() {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Menu principal">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors",
              active ? "bg-white/12 font-medium text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-white/10 px-5 py-4 text-sm">
      <p className="truncate font-medium text-white">{orgName}</p>
      <p className="truncate text-white/60">
        {user.name}
      </p>
      <button
        type="button"
        onClick={logout}
        disabled={leaving}
        className="mt-3 inline-flex items-center gap-2 text-white/70 hover:text-white"
      >
        <LogOut className="size-4" aria-hidden /> Sair
      </button>
    </div>
  );

  return (
    <ToastProvider>
      <div className="min-h-dvh lg:pl-64">
        {/* Barra lateral (desktop) */}
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-ink lg:flex">
          <div className="px-6 py-6">
            <Brand />
          </div>
          {nav}
          {footer}
        </aside>

        {/* Barra superior (celular/tablet) */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-ink px-4 lg:hidden">
          <Brand />
          <button type="button" onClick={() => setOpen(true)} className="rounded p-2 text-white" aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
        </header>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" className="absolute inset-0 bg-ink/50" aria-label="Fechar menu" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-ink">
              <div className="flex items-center justify-between px-5 py-5">
                <Brand />
                <button type="button" onClick={() => setOpen(false)} className="rounded p-2 text-white" aria-label="Fechar menu">
                  <X className="size-5" />
                </button>
              </div>
              {nav}
              {footer}
            </aside>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
