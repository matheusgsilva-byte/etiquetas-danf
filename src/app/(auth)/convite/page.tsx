"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, Button, Field, Input, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";

type InviteInfo = { email: string; company: string; hasAccount: boolean };

function InviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<InviteInfo>(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e) => setLoadError(e.message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/accept-invite", { method: "POST", json: { token, name, password } });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (!info) return <Spinner />;

  return (
    <>
      <p className="text-ink-soft">
        Você foi convidado para a equipe <strong className="text-ink">{info.company}</strong> com o e-mail {info.email}.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {!info.hasAccount && (
          <Field label="Seu nome" htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        <Field
          label={info.hasAccount ? "Senha da sua conta" : "Crie uma senha"}
          htmlFor="password"
          hint={info.hasAccount ? undefined : "Mínimo de 8 caracteres, com letras e números."}
        >
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={info.hasAccount ? "current-password" : "new-password"}
          />
        </Field>
        <Button type="submit" loading={loading} className="w-full" size="lg">
          Aceitar convite
        </Button>
      </form>
    </>
  );
}

export default function InvitePage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Entrar na equipe</h1>
      <Suspense>
        <InviteForm />
      </Suspense>
    </>
  );
}
