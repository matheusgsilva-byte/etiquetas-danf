import { z } from "zod";
import { ApiError, json, parseBody, requireRole, requireSession, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { planLimits } from "@/lib/plans";

const schema = z.object({ plan: z.enum(["FREE", "PRO", "ENTERPRISE"]) });

/**
 * Troca de plano sem cobrança — habilitada apenas com ALLOW_PLAN_SELF_SERVICE=true.
 * Ponto de integração futuro com um gateway de pagamento (ex.: Stripe, Pagar.me).
 */
export const POST = route(async (req) => {
  const s = await requireSession();
  requireRole(s, ["OWNER"]);
  if (!env().ALLOW_PLAN_SELF_SERVICE) {
    throw new ApiError(403, "A troca de plano está desativada. Entre em contato com o suporte.");
  }
  const { plan } = await parseBody(req, schema);
  const limits = planLimits(plan);
  const members = await db.membership.count({ where: { orgId: s.org.id } });
  if (members > limits.maxMembers) {
    throw new ApiError(400, `O plano ${limits.name} permite ${limits.maxMembers} usuário(s). Remova membros antes de mudar.`);
  }
  await db.organization.update({
    where: { id: s.org.id },
    data: { plan, retentionDays: Math.min(s.org.retentionDays, limits.maxRetentionDays) },
  });
  await audit(s.org.id, s.user.id, "org.plan_changed", s.org.id, { from: s.org.plan, to: plan });
  return json({ ok: true });
});
