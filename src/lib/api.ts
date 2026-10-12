/**
 * Utilitários para as rotas de API: erros padronizados, exigência de sessão
 * e validação de corpo com zod.
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { getSession, type SessionContext } from "./auth/session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const json = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Sua sessão expirou. Entre novamente.", "UNAUTHENTICATED");
  return session;
}

export function requireRole(session: SessionContext, roles: SessionContext["role"][]) {
  if (!roles.includes(session.role)) throw new ApiError(403, "Você não tem permissão para esta ação.", "FORBIDDEN");
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Corpo da requisição inválido.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Dados inválidos.", "VALIDATION");
  }
  return parsed.data;
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Envolve um handler tratando erros de forma consistente. */
export function route<C = { params: Promise<Record<string, string | string[]>> }>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ error: err.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
      }
      console.error("[api]", req.method, new URL(req.url).pathname, err);
      return NextResponse.json({ error: "Erro interno. Tente novamente em instantes." }, { status: 500 });
    }
  };
}

export type IdParams = { params: Promise<{ id: string }> };
