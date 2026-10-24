import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa ter ao menos 32 caracteres").optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_SECRET_PREV: z.string().min(32).optional(),
  OTP_PEPPER: z.string().min(32).optional(),
  QR_SIGNING_SECRET: z.string().min(32).optional(),
  DATA_ENCRYPTION_KEYS: z.string().default(""),
  BLIND_INDEX_KEY: z.string().default(""),
  // "todos" (padrão): MFA obrigatório para cliente, loja e admin. "admin": só administradores (útil para liberar aos poucos).
  MFA_ESCOPO: z.enum(["admin", "admin_loja", "todos"]).default("admin_loja"),
  ORIGIN_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_SENHA: z.string().optional(),
  TRUSTED_PROXY: z.enum(["none", "cloudflare", "hops"]).default("none"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_LOGIN_ATIVO: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  LEGACY_BEARER: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  QR_MAX_UNIDADES_POR_MATERIAL: z.coerce.number().int().min(1).max(100000).default(200),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

/** Validação preguiçosa: o build não precisa de segredos, a primeira requisição sim. */
export function env(): Env {
  if (!cached) {
    const r = schema.safeParse(process.env);
    if (!r.success) {
      const campos = r.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Configuração de ambiente inválida: ${campos}`);
    }
    if (r.data.NODE_ENV === "production") {
      const obrigatorias = ["SESSION_SECRET", "OTP_PEPPER", "QR_SIGNING_SECRET", "DATA_ENCRYPTION_KEYS", "BLIND_INDEX_KEY"] as const;
      const ausentes = obrigatorias.filter((k) => !r.data[k]);
      if (ausentes.length) throw new Error(`Configuração de ambiente inválida: ${ausentes.join(", ")}`);
    }
    if (!r.data.JWT_SECRET && !r.data.SESSION_SECRET) throw new Error("Configuração de ambiente inválida: SESSION_SECRET ou JWT_SECRET");
    cached = r.data;
  }
  return cached;
}
