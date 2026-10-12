import type { Prisma } from "@prisma/client";
import { json, requireSession, route } from "@/lib/api";
import { db } from "@/lib/db";
import { serializeJob } from "@/lib/serializers";

const STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"] as const;

/**
 * Histórico de PDFs unificados, com filtros:
 *  q (nome do lote ou de arquivo), status, marketplace, from, to (AAAA-MM-DD), page.
 */
export const GET = route(async (req) => {
  const s = await requireSession();
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = 20;

  const where: Prisma.JobWhereInput = { orgId: s.org.id, deletedAt: null };
  const status = sp.get("status");
  if (status && (STATUSES as readonly string[]).includes(status)) where.status = status as (typeof STATUSES)[number];
  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) {
    where.queuedAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00-03:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999-03:00`) } : {}),
    };
  }
  const marketplace = sp.get("marketplace");
  if (marketplace) where.batch = { labels: { some: { marketplace, excluded: false } } };
  const q = sp.get("q")?.trim();
  if (q) {
    where.AND = [
      {
        OR: [
          { outputName: { contains: q, mode: "insensitive" } },
          { batch: { name: { contains: q, mode: "insensitive" } } },
          { batch: { files: { some: { originalName: { contains: q, mode: "insensitive" } } } } },
        ],
      },
    ];
  }

  const [total, jobs] = await Promise.all([
    db.job.count({ where }),
    db.job.findMany({
      where,
      orderBy: { queuedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { batch: { select: { name: true } } },
    }),
  ]);

  return json({
    total,
    page,
    pageSize,
    jobs: jobs.map((j) => ({ ...serializeJob(j), batchName: j.batch.name })),
  });
});
