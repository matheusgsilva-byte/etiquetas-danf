/**
 * - Redireciona visitantes sem sessão para /login (a validação completa da
 *   sessão acontece no servidor, em cada página e rota).
 * - Bloqueia requisições de escrita vindas de outra origem (proteção CSRF,
 *   somada ao cookie SameSite=Lax).
 */
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login", "/cadastro", "/esqueci-senha", "/redefinir-senha", "/convite"];
const PUBLIC_API = ["/api/auth/", "/api/health", "/api/storage/download"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) {
      return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
    }
  }

  const hasSession = req.cookies.has("lh_session");
  if (isApi) {
    if (!hasSession && !PUBLIC_API.some((p) => pathname.startsWith(p))) {
      return NextResponse.json({ error: "Sua sessão expirou. Entre novamente.", code: "UNAUTHENTICATED" }, { status: 401 });
    }
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
