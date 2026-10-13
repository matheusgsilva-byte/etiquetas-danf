/**
 * Variáveis de ambiente validadas. Lidas sob demanda para não quebrar o build.
 * Veja .env.example para a descrição de cada uma.
 */
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const schema = z
  .object({
    NODE_ENV: z.string().default("development"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    APP_SECRET: z.string().min(32, "APP_SECRET deve ter ao menos 32 caracteres"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default("redis://localhost:6379"),

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./.storage"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool,

    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),

    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("LabelHub Cloud <no-reply@labelhub.local>"),

    ALLOW_REGISTRATION: z
      .string()
      .optional()
      .transform((v) => v !== "0" && v?.toLowerCase() !== "false"),

    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    QPDF_PATH: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_DRIVER === "s3" && !v.S3_BUCKET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "S3_BUCKET é obrigatório quando STORAGE_DRIVER=s3", path: ["S3_BUCKET"] });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
