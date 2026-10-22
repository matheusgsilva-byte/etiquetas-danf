/**
 * Armazenamento de objetos.
 *  - "s3": Amazon S3 ou compatível (Cloudflare R2, MinIO, DigitalOcean Spaces, Wasabi...).
 *  - "local": disco do servidor — apenas para desenvolvimento ou servidor único.
 *
 * Chaves seguem o padrão org/<orgId>/... garantindo isolamento por empresa.
 * O PDF final é entregue pelo próprio servidor (rota de download), sem depender
 * de links pré-assinados do provedor.
 */
import { env } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

export interface SignedUrlOptions {
  filename?: string;
  inline?: boolean;
  contentType?: string;
  ttlSeconds?: number;
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Envia um arquivo do disco sem carregá-lo inteiro na memória. */
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  signedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  /** Lê o objeto em fluxo (para o servidor entregar o arquivo sem carregá-lo inteiro). */
  stream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
}

const globalForStorage = globalThis as unknown as { storage?: ObjectStorage };

export function storage(): ObjectStorage {
  if (globalForStorage.storage) return globalForStorage.storage;
  const e = env();
  const instance: ObjectStorage = e.STORAGE_DRIVER === "s3" ? new S3Storage(e) : new LocalStorage(e);
  globalForStorage.storage = instance;
  return instance;
}

export const keys = {
  source: (orgId: string, batchId: string, fileId: string) => `org/${orgId}/batches/${batchId}/sources/${fileId}.pdf`,
  thumbnail: (orgId: string, batchId: string, fileId: string, pageIndex: number) =>
    `org/${orgId}/batches/${batchId}/thumbs/${fileId}-${pageIndex}.jpg`,
  output: (orgId: string, jobId: string) => `org/${orgId}/outputs/${jobId}.pdf`,
  batchPrefix: (orgId: string, batchId: string) => `org/${orgId}/batches/${batchId}/`,
  orgPrefix: (orgId: string) => `org/${orgId}/`,
};

/** Garante que uma chave pertence à organização (defesa em profundidade). */
export function assertOrgKey(orgId: string, key: string) {
  if (!key.startsWith(`org/${orgId}/`) || key.includes("..")) {
    throw new Error("Chave de armazenamento fora do escopo da organização.");
  }
}
