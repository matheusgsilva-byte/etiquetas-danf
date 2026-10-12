import type { Organization } from "@prisma/client";
import { ApiError } from "./api";
import { db } from "./db";
import { MB, planLimits } from "./plans";

export function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

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

export async function assertStorageAvailable(org: Organization, incomingBytes: number) {
  const limits = planLimits(org.plan);
  const usage = await getUsage(org.id);
  if (usage.storageBytes + incomingBytes > limits.storageMb * MB) {
    throw new ApiError(
      403,
      `Limite de armazenamento do plano ${limits.name} atingido (${limits.storageMb} MB). Exclua lotes antigos ou reduza o período de retenção.`,
      "PLAN_LIMIT",
    );
  }
}

export async function assertMonthlyLabels(org: Organization, labels: number) {
  const limits = planLimits(org.plan);
  const usage = await getUsage(org.id);
  if (usage.labelsThisMonth + labels > limits.monthlyLabels) {
    const left = Math.max(0, limits.monthlyLabels - usage.labelsThisMonth);
    throw new ApiError(
      403,
      `O plano ${limits.name} permite ${limits.monthlyLabels} etiquetas por mês. Restam ${left} neste mês e este lote tem ${labels}.`,
      "PLAN_LIMIT",
    );
  }
}
