import { ApiError, json, requireRole, requireSession, route, type IdParams } from "@/lib/api";
import { db } from "@/lib/db";

export const DELETE = route(async (_req, { params }: IdParams) => {
  const s = await requireSession();
  requireRole(s, ["OWNER", "ADMIN"]);
  const { id } = await params;
  const res = await db.invite.deleteMany({ where: { id, orgId: s.org.id, acceptedAt: null } });
  if (!res.count) throw new ApiError(404, "Convite não encontrado.");
  return json({ ok: true });
});
