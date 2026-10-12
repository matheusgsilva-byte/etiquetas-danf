import { json, requireSession, route } from "@/lib/api";
import { env } from "@/lib/env";
import { normalizeSettings } from "@/lib/output-settings";
import { PLANS, planLimits } from "@/lib/plans";
import { getUsage } from "@/lib/usage";

export const GET = route(async () => {
  const s = await requireSession();
  const usage = await getUsage(s.org.id);
  return json({
    user: s.user,
    role: s.role,
    org: {
      id: s.org.id,
      name: s.org.name,
      plan: s.org.plan,
      retentionDays: s.org.retentionDays,
      deleteSourcesAfterGeneration: s.org.deleteSourcesAfterGeneration,
      defaultSettings: normalizeSettings(s.org.defaultSettings),
    },
    limits: planLimits(s.org.plan),
    plans: PLANS,
    usage,
    planSelfService: env().ALLOW_PLAN_SELF_SERVICE,
  });
});
