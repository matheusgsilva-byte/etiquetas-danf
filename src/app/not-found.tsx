import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-sm text-ink-faint">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Página não encontrada</h1>
      <p className="mt-2 max-w-md text-ink-soft">O endereço pode ter mudado, ou este item foi excluído pela política de retenção.</p>
      <Link href="/dashboard" className="mt-6 inline-flex h-10 items-center rounded-md bg-action px-4 font-medium text-white hover:bg-action-dark">
        Ir para o dashboard
      </Link>
    </main>
  );
}
