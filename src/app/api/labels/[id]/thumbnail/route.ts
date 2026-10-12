import { ApiError, requireSession, route, type IdParams } from "@/lib/api";
import { db } from "@/lib/db";
import { assertOrgKey, storage } from "@/lib/storage";

export const GET = route(async (_req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const label = await db.label.findFirst({
    where: { id, batch: { orgId: s.org.id } },
    select: { thumbnailKey: true },
  });
  if (!label?.thumbnailKey) throw new ApiError(404, "Miniatura indisponível.");
  assertOrgKey(s.org.id, label.thumbnailKey);
  const bytes = await storage().get(label.thumbnailKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
