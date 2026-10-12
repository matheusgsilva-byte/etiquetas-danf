import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { contentDisposition, decodeDownloadToken } from "@/lib/storage/signing";

export const runtime = "nodejs";

/** Entrega de arquivos do armazenamento local via link assinado e temporário. */
export async function GET(req: Request) {
  if (env().STORAGE_DRIVER !== "local") return new Response("Não encontrado", { status: 404 });
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const token = decodeDownloadToken(t, env().APP_SECRET);
  if (!token) return new Response("Link inválido ou expirado.", { status: 403 });
  try {
    const bytes = await storage().get(token.key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": token.ct ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDisposition(token.fn ?? "arquivo", token.inline),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Arquivo não encontrado.", { status: 404 });
  }
}
