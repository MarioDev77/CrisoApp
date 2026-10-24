import { createHash } from "node:crypto";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { chaveRateLimit } from "./crypto";
import { env } from "./env";

export type Regra = { nome: string; max: number; janelaSeg: number; msg?: string };

/**
 * Janela fixa distribuída: o contador vive no PostgreSQL, então é compartilhado entre
 * instâncias e sobrevive a deploys. Uma única instrução atômica (upsert) por verificação.
 */
const memoria = new Map<string, { contagem: number; expira: number }>();
const MAX_CHAVES_MEMORIA = 5000;

export async function limitar(regra: Regra, id: string, _ocultarId = false): Promise<void> {
  const chaveLogica = `${regra.nome}:${id}`;
  const agora = Date.now();
  let local = memoria.get(chaveLogica);
  if (!local || local.expira <= agora) {
    local = { contagem: 0, expira: agora + regra.janelaSeg * 1000 };
    if (memoria.size >= MAX_CHAVES_MEMORIA) {
      for (const [k, v] of memoria) if (v.expira <= agora) memoria.delete(k);
      if (memoria.size >= MAX_CHAVES_MEMORIA) memoria.delete(memoria.keys().next().value!);
    }
    memoria.set(chaveLogica, local);
  }
  local.contagem++;
  if (local.contagem > regra.max) throw new HttpError(429, regra.msg ?? "Muitas requisições. Tente novamente em instantes.", { retryAfter: Math.max(1, Math.ceil((local.expira - agora) / 1000)) });

  // A chave persistida é fixa e não revela IP, e-mail ou identificador de conta.
  const e = env();
  const identificador = e.DATA_ENCRYPTION_KEYS && e.BLIND_INDEX_KEY
    ? chaveRateLimit(chaveLogica)
    : createHash("sha256").update(chaveLogica.toLowerCase()).digest("hex").slice(0, 32);
  const chave = `${regra.nome}:${identificador}`;
  const rows = await prisma().$queryRaw<{ contagem: number; ttl: number }[]>`
    INSERT INTO rate_limits (chave, contagem, expira_em)
    VALUES (${chave}, 1, now() + make_interval(secs => ${regra.janelaSeg}))
    ON CONFLICT (chave) DO UPDATE SET
      contagem = CASE WHEN rate_limits.expira_em <= now() THEN 1 ELSE rate_limits.contagem + 1 END,
      expira_em = CASE WHEN rate_limits.expira_em <= now()
                       THEN now() + make_interval(secs => ${regra.janelaSeg})
                       ELSE rate_limits.expira_em END
    RETURNING contagem, CEIL(EXTRACT(EPOCH FROM (expira_em - now())))::int AS ttl`;
  const r = rows[0];
  if (r.contagem > regra.max) {
    throw new HttpError(429, regra.msg ?? "Muitas requisições. Tente novamente em instantes.", {
      retryAfter: Math.max(1, r.ttl),
    });
  }
}

/** Remove contadores vencidos; executado pelo endpoint de manutenção protegido. */
export async function limparExpirados(): Promise<number> {
  return prisma().$executeRaw`DELETE FROM rate_limits WHERE expira_em < now() - interval '1 hour'`;
}
