import { z } from "zod";
import { json, parseBody, requireSession, route } from "@/lib/api";
import { db } from "@/lib/db";
import { normalizeSettings } from "@/lib/output-settings";
import { serializeBatch } from "@/lib/serializers";

/** Lotes em andamento (ainda sem PDF gerado) — para retomar uma unificação. */
export const GET = route(async () => {
  const s = await requireSession();
  const batches = await db.batch.findMany({
    where: { orgId: s.org.id, status: { in: ["DRAFT", "ANALYZING", "READY", "GENERATING", "FAILED"] }, files: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: { _count: { select: { files: true, labels: true } } },
  });
  return json({
    batches: batches.map((b) => ({ ...serializeBatch(b), files: b._count.files, labels: b._count.labels })),
  });
});

const schema = z.object({ name: z.string().trim().max(120).optional() });

export const POST = route(async (req) => {
  const s = await requireSession();
  const body = await parseBody(req, schema);
  const now = new Date();
  const name =
    body.name ||
    `Unificação ${now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}`;
  const batch = await db.batch.create({
    data: { orgId: s.org.id, createdById: s.user.id, name, settings: normalizeSettings(s.org.defaultSettings) },
  });
  return json({ batch: serializeBatch(batch) }, { status: 201 });
});
