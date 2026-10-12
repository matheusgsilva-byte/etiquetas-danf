import { ApiError, json, requireRole, requireSession, route, type IdParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export const DELETE = route(async (_req, { params }: IdParams) => {
  const s = await requireSession();
  requireRole(s, ["OWNER", "ADMIN"]);
  const { id } = await params;
  const member = await db.membership.findFirst({ where: { id, orgId: s.org.id } });
  if (!member) throw new ApiError(404, "Membro não encontrado.");
  if (member.role === "OWNER") throw new ApiError(400, "O proprietário não pode ser removido.");
  if (member.userId === s.user.id) throw new ApiError(400, "Você não pode remover a si mesmo.");
  await db.$transaction([
    db.membership.delete({ where: { id } }),
    db.session.deleteMany({ where: { userId: member.userId, orgId: s.org.id } }),
  ]);
  await audit(s.org.id, s.user.id, "member.removed", member.userId);
  return json({ ok: true });
});
