import { db } from "./db";

export function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Números de uso da empresa (apenas informativos — não há cotas). */
export async function getUsage(orgId: string) {
  const [labels, sources, outputs, members] = await Promise.all([
    db.job.aggregate({
      where: { orgId, status: "COMPLETED", finishedAt: { gte: startOfMonth() } },
      _sum: { labelsIncluded: true },
    }),
    db.sourceFile.aggregate({ where: { orgId, purgedAt: null }, _sum: { sizeBytes: true } }),
    db.job.aggregate({ where: { orgId, status: "COMPLETED", deletedAt: null }, _sum: { outputSize: true } }),
    db.membership.count({ where: { orgId } }),
  ]);
  return {
    labelsThisMonth: labels._sum.labelsIncluded ?? 0,
    storageBytes: (sources._sum.sizeBytes ?? 0) + (outputs._sum.outputSize ?? 0),
    members,
  };
}
