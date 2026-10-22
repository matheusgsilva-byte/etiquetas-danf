import { ApiError, requireSession, route, type IdParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientInfo } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assertOrgKey, storage } from "@/lib/storage";
import { contentDisposition } from "@/lib/storage/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrega o PDF gerado direto pelo servidor (em fluxo, sem carregar na memória).
 * Antes era um redirecionamento para um link pré-assinado do armazenamento, que
 * o provedor passou a recusar (SignatureDoesNotMatch).
 * ?inline=1 abre no navegador para visualização.
 */
export const GET = route(async (req, { params }: IdParams) => {
  const s = await requireSession();
  const { id } = await params;
  const job = await db.job.findFirst({ where: { id, orgId: s.org.id, deletedAt: null } });
  if (!job) throw new ApiError(404, "Processamento não encontrado.");
  if (job.status === "EXPIRED") throw new ApiError(410, "Este PDF expirou pela política de retenção e foi excluído.");
  if (job.status !== "COMPLETED" || !job.outputKey) throw new ApiError(409, "O PDF ainda não está disponível.");
  assertOrgKey(s.org.id, job.outputKey);

  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const file = await storage().stream(job.outputKey);
  if (!file) throw new ApiError(410, "O arquivo deste PDF não foi encontrado no armazenamento. Gere o PDF novamente.");
  const { ip } = await clientInfo();
  await audit(s.org.id, s.user.id, inline ? "job.viewed" : "job.downloaded", id, undefined, ip);
  return new Response(file.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      ...(file.size ? { "Content-Length": String(file.size) } : {}),
      "Content-Disposition": contentDisposition(job.outputName ?? "etiquetas.pdf", inline),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
