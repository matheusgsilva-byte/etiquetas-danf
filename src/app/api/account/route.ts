import { z } from "zod";
import { json, parseBody, requireSession, route } from "@/lib/api";
import { db } from "@/lib/db";

const schema = z.object({ name: z.string().trim().min(2, "Informe seu nome.").max(100) });

export const PATCH = route(async (req) => {
  const s = await requireSession();
  const { name } = await parseBody(req, schema);
  await db.user.update({ where: { id: s.user.id }, data: { name } });
  return json({ ok: true });
});
