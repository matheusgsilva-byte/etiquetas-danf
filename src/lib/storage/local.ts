import { mkdir, readFile, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Env } from "../env";
import type { ObjectStorage, SignedUrlOptions } from "./index";
import { encodeDownloadToken } from "./signing";

export class LocalStorage implements ObjectStorage {
  private root: string;

  constructor(private config: Env) {
    this.root = path.resolve(config.STORAGE_LOCAL_DIR);
  }

  resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Chave inválida.");
    return full;
  }

  async put(key: string, body: Uint8Array) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    // Escrita atômica: nunca expõe um arquivo pela metade.
    const tmp = `${full}.${randomUUID()}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, full);
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async head(key: string) {
    try {
      const s = await stat(this.resolve(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string) {
    const dir = this.resolve(prefix.replace(/\/$/, ""));
    await rm(dir, { recursive: true, force: true });
  }

  async signedUrl(key: string, options: SignedUrlOptions = {}) {
    const ttl = options.ttlSeconds ?? this.config.SIGNED_URL_TTL_SECONDS;
    const token = encodeDownloadToken(
      { key, exp: Math.floor(Date.now() / 1000) + ttl, fn: options.filename, inline: options.inline, ct: options.contentType },
      this.config.APP_SECRET,
    );
    return `${this.config.APP_URL.replace(/\/$/, "")}/api/storage/download?t=${encodeURIComponent(token)}`;
  }
}
