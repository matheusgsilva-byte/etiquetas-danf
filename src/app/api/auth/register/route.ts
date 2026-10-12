import { z } from "zod";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/auth/crypto";
import { clientInfo, createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { DEFAULT_OUTPUT_SETTINGS } from "@/lib/output-settings";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(100),
  company: z.string().trim().min(2, "Informe o nome da empresa ou loja.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "É preciso aceitar os termos e a política de privacidade." }) }),
});

export const POST = route(async (req) => {
  if (!env().ALLOW_REGISTRATION) throw new ApiError(403, "Novos cadastros estão desativados.");
  const { ip } = await clientInfo();
  await rateLimit(`register:${ip ?? "?"}`, 10, 3600);

  const body = await parseBody(req, schema);
  const problem = passwordProblem(body.password);
  if (problem) throw new ApiError(400, problem);

  const exists = await db.user.findUnique({ where: { email: body.email } });
  if (exists) throw new ApiError(409, "Já existe uma conta com este e-mail. Entre ou recupere sua senha.");

  const passwordHash = await hashPassword(body.password);
  const { user, org } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash } });
    const org = await tx.organization.create({
      data: { name: body.company, defaultSettings: DEFAULT_OUTPUT_SETTINGS },
    });
    await tx.membership.create({ data: { userId: user.id, orgId: org.id, role: "OWNER" } });
    return { user, org };
  });

  await createSession(user.id, org.id);
  await audit(org.id, user.id, "account.created", user.id, undefined, ip);
  return json({ ok: true });
});
