import { json, requireSession, route } from "@/lib/api";
import { normalizeSettings } from "@/lib/output-settings";
import { LIMITS } from "@/lib/plans";
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
      retentionDays: s.org.retentionDays,
      deleteSourcesAfterGeneration: s.org.deleteSourcesAfterGeneration,
      defaultSettings: normalizeSettings(s.org.defaultSettings),
    },
    limits: LIMITS,
    usage,
  });
});
