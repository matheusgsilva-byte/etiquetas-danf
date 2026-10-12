"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <p className="mt-1 text-ink-soft">Acesse sua conta para unificar etiquetas.</p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Link href="/esqueci-senha" className="text-sm text-action hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" loading={loading} className="w-full" size="lg">
          Entrar
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-action hover:underline">
          Criar conta grátis
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
