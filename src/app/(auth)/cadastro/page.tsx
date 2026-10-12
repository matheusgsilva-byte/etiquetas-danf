"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/register", { method: "POST", json: { ...form, acceptTerms: accept } });
      router.replace("/unificar");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Criar conta</h1>
      <p className="mt-1 text-ink-soft">Comece no plano gratuito. Sem cartão de crédito.</p>
      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Seu nome" htmlFor="name">
          <Input id="name" autoComplete="name" required value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Empresa ou loja" htmlFor="company">
          <Input id="company" autoComplete="organization" required value={form.company} onChange={set("company")} />
        </Field>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres, com letras e números.">
          <Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={set("password")} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-ink-soft">
          <input type="checkbox" className="mt-1 size-4 accent-action" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            Li e aceito os termos de uso e a política de privacidade. As etiquetas contêm dados pessoais de destinatários e serão
            tratadas conforme a LGPD.
          </span>
        </label>
        <Button type="submit" loading={loading} className="w-full" size="lg">
          Criar conta
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-action hover:underline">
          Entrar
        </Link>
      </p>
    </>
  );
}
