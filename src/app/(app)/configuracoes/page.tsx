"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Trash2, UserPlus } from "lucide-react";
import { SettingsPanel } from "@/components/unify/settings-panel";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Toggle, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/use-me";
import { formatDate } from "@/lib/format";
import { normalizeSettings, type OutputSettings } from "@/lib/output-settings";

type Member = { id: string; role: string; createdAt: string; isYou: boolean; user: { name: string; email: string } };
type Invite = { id: string; email: string; role: string; expiresAt: string };
const ROLE: Record<string, string> = { OWNER: "Proprietário", ADMIN: "Administrador", MEMBER: "Operador" };

function Team({ canManage, maxMembers, planName }: { canManage: boolean; maxMembers: number; planName: string }) {
  const toast = useToast();
  const [data, setData] = useState<{ members: Member[]; invites: Invite[] } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ members: Member[]; invites: Invite[] }>("/api/org/members").then(setData);
  }, []);
  useEffect(() => load(), [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const r = await api<{ link: string }>("/api/org/members", { method: "POST", json: { email, role } });
      setLink(r.link);
      setEmail("");
      toast("Convite criado.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function remove(url: string) {
    try {
      await api(url, { method: "DELETE" });
      load();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  }

  const used = (data?.members.length ?? 0) + (data?.invites.length ?? 0);

  return (
    <Card title="Equipe" description={`${used} de ${maxMembers} usuário(s) no plano ${planName}.`}>
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <ul className="divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {m.user.name} {m.isYou && <span className="font-normal text-ink-faint">(você)</span>}
                  </p>
                  <p className="truncate text-sm text-ink-faint">{m.user.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{ROLE[m.role]}</Badge>
                  {canManage && m.role !== "OWNER" && !m.isYou && (
                    <button type="button" onClick={() => remove(`/api/org/members/${m.id}`)} className="rounded p-1.5 text-ink-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remover ${m.user.name}`}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate">{i.email}</p>
                  <p className="text-sm text-ink-faint">Convite pendente · expira em {formatDate(i.expiresAt)}</p>
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => remove(`/api/org/invites/${i.id}`)}>
                    Cancelar convite
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {canManage && (
            <form onSubmit={invite} className="space-y-3 border-t border-line pt-4">
              {error && <Alert tone="warn">{error}</Alert>}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                <Input type="email" placeholder="email@empresa.com.br" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail do convidado" required />
                <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Função">
                  <option value="MEMBER">Operador</option>
                  <option value="ADMIN">Administrador</option>
                </Select>
                <Button type="submit" loading={sending}>
                  <UserPlus className="size-4" aria-hidden /> Convidar
                </Button>
              </div>
              {link && (
                <Alert tone="ok" title="Convite enviado por e-mail">
                  Você também pode compartilhar este link diretamente (válido por 7 dias):
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-xs text-ink">{link}</code>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => navigator.clipboard.writeText(link).then(() => toast("Link copiado."))}
                    >
                      <Copy className="size-3.5" aria-hidden /> Copiar
                    </Button>
                  </div>
                </Alert>
              )}
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { me, error, reload } = useMe();
  const [name, setName] = useState("");
  const [retention, setRetention] = useState(7);
  const [deleteSources, setDeleteSources] = useState(false);
  const [defaults, setDefaults] = useState<OutputSettings | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setName(me.org.name);
    setRetention(me.org.retentionDays);
    setDeleteSources(me.org.deleteSourcesAfterGeneration);
    setDefaults(me.org.defaultSettings);
  }, [me]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!me || !defaults) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }
  const canManage = me.role === "OWNER" || me.role === "ADMIN";

  async function save(section: string, body: Record<string, unknown>) {
    setSaving(section);
    try {
      await api("/api/org", { method: "PATCH", json: body });
      toast("Configurações salvas.");
      reload();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <PageHeader title="Configurações" description="Preferências da empresa, privacidade dos dados e equipe." />
      {!canManage && (
        <Alert tone="info" className="mb-6">
          Somente proprietários e administradores podem alterar estas configurações.
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="Empresa">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save("org", { name });
              }}
            >
              <Field label="Nome da empresa ou loja" htmlFor="org-name">
                <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
              </Field>
              <Button type="submit" variant="secondary" loading={saving === "org"} disabled={!canManage}>
                Salvar nome
              </Button>
            </form>
          </Card>

          <Card title="Retenção e privacidade" description="As etiquetas contêm nomes e endereços de destinatários (dados pessoais protegidos pela LGPD).">
            <div className="space-y-5">
              <div>
                <label htmlFor="retention" className="mb-2 flex justify-between text-sm font-medium">
                  <span>Guardar arquivos por</span>
                  <span className="tabular-nums">{retention} dia(s)</span>
                </label>
                <input
                  id="retention"
                  type="range"
                  min={1}
                  max={me.limits.maxRetentionDays}
                  value={retention}
                  onChange={(e) => setRetention(Number(e.target.value))}
                  disabled={!canManage}
                  className="w-full accent-action"
                />
                <p className="mt-1 text-xs text-ink-faint">
                  Depois desse prazo, os PDFs enviados, as miniaturas e os PDFs gerados são excluídos automaticamente. O histórico mantém apenas os
                  números da operação. Máximo do plano {me.limits.name}: {me.limits.maxRetentionDays} dias.
                </p>
              </div>
              <Toggle
                checked={deleteSources}
                onChange={setDeleteSources}
                disabled={!canManage}
                label="Apagar PDFs de origem após gerar"
                description="Mantém só o PDF unificado. O lote não poderá ser gerado novamente."
              />
              <Button
                variant="secondary"
                loading={saving === "privacy"}
                disabled={!canManage}
                onClick={() => save("privacy", { retentionDays: retention, deleteSourcesAfterGeneration: deleteSources })}
              >
                Salvar privacidade
              </Button>
            </div>
          </Card>

          <Team canManage={canManage} maxMembers={me.limits.maxMembers} planName={me.limits.name} />
        </div>

        <Card title="Impressão padrão" description="Usada ao iniciar cada nova unificação. Pode ser ajustada em cada lote.">
          <SettingsPanel settings={defaults} onChange={(p) => setDefaults(normalizeSettings({ ...defaults, ...p }))} locked={!canManage} />
          <Button className="mt-5" variant="secondary" loading={saving === "defaults"} disabled={!canManage} onClick={() => save("defaults", { defaultSettings: defaults })}>
            Salvar impressão padrão
          </Button>
        </Card>
      </div>
    </div>
  );
}
