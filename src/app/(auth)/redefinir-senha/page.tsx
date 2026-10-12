"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, Button, ButtonLink, Field, Input } from "@/components/ui";
import { api } from "@/lib/client/api";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("As senhas não conferem.");
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/reset-password", { method: "POST", json: { token, password } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <Alert tone="danger" title="Link incompleto">
        Abra o link exatamente como recebido no e-mail ou{" "}
        <Link href="/esqueci-senha" className="underline">
          solicite um novo
        </Link>
        .
      </Alert>
    );
  }

  return done ? (
    <div className="space-y-4">
      <Alert tone="ok" title="Senha alterada">
        Por segurança, encerramos as sessões abertas. Entre com a nova senha.
      </Alert>
      <ButtonLink href="/login" className="w-full" size="lg">
        Entrar
      </ButtonLink>
    </div>
  ) : (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Nova senha" htmlFor="password" hint="Mínimo de 8 caracteres, com letras e números.">
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Repita a nova senha" htmlFor="confirm">
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" loading={loading} className="w-full" size="lg">
        Salvar nova senha
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold">Criar nova senha</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
