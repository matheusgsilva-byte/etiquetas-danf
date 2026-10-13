"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/use-me";
import { formatBytes, formatNumber } from "@/lib/format";

export default function AccountPage() {
  const router = useRouter();
  const toast = useToast();
  const { me, error, reload } = useMe();
  const [name, setName] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (me) setName(me.user.name);
  }, [me]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!me) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast(ok);
      reload();
      return true;
    } catch (err) {
      toast((err as Error).message, "danger");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setBusy("pw");
    try {
      await api("/api/account/password", { method: "POST", json: pw });
      setPw({ current: "", next: "" });
      toast("Senha alterada. As outras sessões foram encerradas.");
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteCompany() {
    setBusy("delete");
    try {
      await api("/api/org", { method: "DELETE", json: { confirm: confirmName } });
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "danger");
      setBusy(null);
    }
  }


  return (
    <div>
      <PageHeader title="Conta" description={`${me.user.email} · ${me.org.name}`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Perfil">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run("name", () => api("/api/account", { method: "PATCH", json: { name } }), "Nome atualizado.");
            }}
          >
            <Field label="Seu nome" htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="E-mail" htmlFor="email" hint="Para trocar o e-mail, fale com o suporte.">
              <Input id="email" value={me.user.email} disabled />
            </Field>
            <Button type="submit" variant="secondary" loading={busy === "name"}>
              Salvar perfil
            </Button>
          </form>
        </Card>

        <Card title="Senha">
          <form className="space-y-4" onSubmit={changePassword}>
            {pwError && <Alert tone="danger">{pwError}</Alert>}
            <Field label="Senha atual" htmlFor="current">
              <Input id="current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="Nova senha" htmlFor="next" hint="Mínimo de 8 caracteres, com letras e números.">
              <Input id="next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Button type="submit" variant="secondary" loading={busy === "pw"}>
              Alterar senha
            </Button>
          </form>
        </Card>
      </div>

      <section className="mt-8 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-base font-semibold">Uso</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {formatNumber(me.usage.labelsThisMonth)} etiquetas unificadas neste mês · {formatBytes(me.usage.storageBytes)} armazenados ·{" "}
          {me.usage.members} usuário(s). Sem limites de etiquetas, arquivos, armazenamento ou usuários.
        </p>
      </section>

      {me.role === "OWNER" && (
        <section className="mt-10 rounded-lg border border-danger/30 bg-surface p-5">
          <h2 className="font-semibold text-danger">Excluir empresa e todos os dados</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Apaga definitivamente os PDFs enviados e gerados, o histórico, as configurações e os acessos da equipe. Use para exercer o direito de
            eliminação previsto na LGPD.
          </p>
          <Button variant="danger" className="mt-4" onClick={() => setDeleteOpen(true)}>
            Excluir empresa
          </Button>
        </section>
      )}

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Excluir empresa definitivamente"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={deleteCompany} loading={busy === "delete"} disabled={confirmName.trim() !== me.org.name.trim()}>
              Excluir tudo
            </Button>
          </>
        }
      >
        <p>
          Digite <strong className="text-ink">{me.org.name}</strong> para confirmar.
        </p>
        <Input className="mt-3" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Nome da empresa" />
      </Modal>
    </div>
  );
}
