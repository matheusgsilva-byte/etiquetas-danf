import { json, requireSession, route } from "@/lib/api";
import { db } from "@/lib/db";
import { planLimits } from "@/lib/plans";
import { serializeJob } from "@/lib/serializers";
import { getUsage } from "@/lib/usage";

/** Indicadores do painel. ?days=7|30|90 (padrão 30). */
export const GET = route(async (req) => {
  const s = await requireSession();
  const daysParam = Number(new URL(req.url).searchParams.get("days") ?? 30);
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 30;
  const since = new Date(Date.now() - days * 86_400_000);
  const orgId = s.org.id;

  const [filesImported, labelsIdentified, completedJobs, statusCounts, recent, active, usage] = await Promise.all([
    db.sourceFile.count({ where: { orgId, createdAt: { gte: since } } }),
    db.label.count({ where: { batch: { orgId }, createdAt: { gte: since } } }),
    db.job.findMany({
      where: { orgId, status: { in: ["COMPLETED", "EXPIRED"] }, finishedAt: { gte: since } },
      select: { pageCount: true, labelsIncluded: true, labelsDiscarded: true, marketplaceCounts: true, durationMs: true, finishedAt: true },
    }),
    db.job.groupBy({ by: ["status"], where: { orgId, queuedAt: { gte: since } }, _count: true }),
    db.job.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { queuedAt: "desc" },
      take: 8,
      include: { batch: { select: { name: true } } },
    }),
    db.job.count({ where: { orgId, status: { in: ["QUEUED", "PROCESSING"] } } }),
    getUsage(orgId),
  ]);

  const byMarketplace: Record<string, number> = {};
  let pagesGenerated = 0;
  let labelsPrinted = 0;
  let labelsDiscarded = 0;
  let durationSum = 0;
  let durationCount = 0;
  const daily = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    daily.set(d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }), 0);
  }
  for (const j of completedJobs) {
    pagesGenerated += j.pageCount ?? 0;
    labelsPrinted += j.labelsIncluded;
    labelsDiscarded += j.labelsDiscarded;
    if (j.durationMs) {
      durationSum += j.durationMs;
      durationCount++;
    }
    for (const [mp, n] of Object.entries((j.marketplaceCounts as Record<string, number>) ?? {})) {
      byMarketplace[mp] = (byMarketplace[mp] ?? 0) + n;
    }
    if (j.finishedAt) {
      const key = j.finishedAt.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
      if (daily.has(key)) daily.set(key, daily.get(key)! + j.labelsIncluded);
    }
  }

  return json({
    days,
    totals: {
      filesImported,
      labelsIdentified,
      labelsPrinted,
      labelsDiscarded,
      pagesGenerated,
      pdfsGenerated: completedJobs.length,
      avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : null,
      activeJobs: active,
    },
    byMarketplace,
    statusCounts: Object.fromEntries(statusCounts.map((c) => [c.status, c._count])),
    daily: [...daily.entries()].map(([date, labels]) => ({ date, labels })),
    recent: recent.map((j) => ({ ...serializeJob(j), batchName: j.batch.name })),
    usage,
    limits: planLimits(s.org.plan),
  });
});
