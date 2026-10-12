"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/forgot-password", { method: "POST", json: { email } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      <p className="mt-1 text-ink-soft">Enviaremos um link para você criar uma nova senha.</p>
      {sent ? (
        <Alert tone="ok" className="mt-8" title="Verifique seu e-mail">
          Se houver uma conta com {email}, você receberá o link em instantes. Ele vale por 1 hora.
        </Alert>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="E-mail da conta" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" loading={loading} className="w-full" size="lg">
            Enviar link de recuperação
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-action hover:underline">
          Voltar para o login
        </Link>
      </p>
    </>
  );
}
