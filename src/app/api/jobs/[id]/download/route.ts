import { NextResponse } from "next/server";
import { ApiError, requireSession, route, type IdParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientInfo } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { assertOrgKey, storage } from "@/lib/storage";

/**
 * Gera um link temporário (assinado) para o PDF e redireciona.
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
  const url = await storage().signedUrl(job.outputKey, {
    filename: job.outputName ?? "etiquetas.pdf",
    inline,
    contentType: "application/pdf",
  });
  const { ip } = await clientInfo();
  await audit(s.org.id, s.user.id, inline ? "job.viewed" : "job.downloaded", id, undefined, ip);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
});
