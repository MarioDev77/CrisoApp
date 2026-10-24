import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa ter ao menos 32 caracteres"),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_SENHA: z.string().optional(),
  TRUSTED_PROXY: z.enum(["none", "cloudflare", "hops"]).default("none"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  LEGACY_BEARER: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  QR_MAX_UNIDADES_POR_MATERIAL: z.coerce.number().int().min(1).max(100000).default(1000),
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
    cached = r.data;
  }
  return cached;
}
