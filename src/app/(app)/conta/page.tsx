"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Alert, Badge, Button, Card, cx, Field, Input, Modal, PageHeader, ProgressBar, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/use-me";
import { formatBytes, formatNumber } from "@/lib/format";
import type { PlanId } from "@/lib/plans";

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

  const planIds = Object.keys(me.plans) as PlanId[];

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

      <section className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">Plano e uso</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Uso neste mês: {formatNumber(me.usage.labelsThisMonth)} de {formatNumber(me.limits.monthlyLabels)} etiquetas ·{" "}
          {formatBytes(me.usage.storageBytes)} armazenados.
        </p>
        <div className="mb-4 max-w-md">
          <ProgressBar value={(me.usage.labelsThisMonth / me.limits.monthlyLabels) * 100} label="Uso mensal de etiquetas" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {planIds.map((id) => {
            const p = me.plans[id];
            const current = me.org.plan === id;
            return (
              <div key={id} className={cx("flex flex-col rounded-lg border bg-surface p-5", current ? "border-action ring-1 ring-action" : "border-line")}>
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold">{p.name}</p>
                  {current && <Badge tone="info">Plano atual</Badge>}
                </div>
                <p className="mt-1 text-sm text-ink-soft">{p.description}</p>
                <p className="mt-3 text-xl font-semibold">{p.priceLabel}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  {[
                    `${formatNumber(p.monthlyLabels)} etiquetas por mês`,
                    `${p.maxFilesPerBatch} arquivos por unificação`,
                    `${formatNumber(p.maxPagesPerBatch)} páginas por unificação`,
                    `Arquivos de até ${p.maxFileSizeMb} MB`,
                    `Histórico de até ${p.maxRetentionDays} dias`,
                    p.maxMembers === 1 ? "1 usuário" : `Até ${p.maxMembers} usuários`,
                  ].map((t) => (
                    <li key={t} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
                {!current && me.planSelfService && me.role === "OWNER" && (
                  <Button
                    className="mt-5"
                    variant={id === "FREE" ? "secondary" : "primary"}
                    loading={busy === `plan-${id}`}
                    onClick={() => run(`plan-${id}`, () => api("/api/org/plan", { method: "POST", json: { plan: id } }), `Plano alterado para ${p.name}.`).then(() => router.refresh())}
                  >
                    Mudar para {p.name}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {!me.planSelfService && (
          <p className="mt-3 text-sm text-ink-faint">Para mudar de plano, fale com o suporte. A cobrança ainda não é feita pela plataforma.</p>
        )}
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
