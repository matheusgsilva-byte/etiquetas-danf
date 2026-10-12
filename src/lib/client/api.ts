"use client";

export class ClientApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(0, "Sem conexão com o servidor. Verifique sua internet.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ClientApiError(res.status, (data as { error?: string }).error ?? "Algo deu errado.", (data as { code?: string }).code);
  }
  return data as T;
}

/** Envia um arquivo com acompanhamento de progresso. */
export function uploadWithProgress<T>(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ClientApiError(xhr.status, body.error ?? "Falha no envio.", body.code));
    };
    xhr.onerror = () => reject(new ClientApiError(0, "Falha de conexão durante o envio."));
    xhr.onabort = () => reject(new ClientApiError(0, "Envio cancelado."));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}
