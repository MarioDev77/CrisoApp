import { prisma } from "./db";
import { HttpError } from "./errors";

export type Regra = { nome: string; max: number; janelaSeg: number; msg?: string };

/**
 * Janela fixa distribuída: o contador vive no PostgreSQL, então é compartilhado entre
 * instâncias e sobrevive a deploys. Uma única instrução atômica (upsert) por verificação.
 */
export async function limitar(regra: Regra, id: string): Promise<void> {
  const chave = `${regra.nome}:${id}`.slice(0, 255);
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

/** Remove contadores vencidos (chamado de /api/ready de forma oportunista e pelo job de manutenção). */
export async function limparExpirados(): Promise<number> {
  return prisma().$executeRaw`DELETE FROM rate_limits WHERE expira_em < now() - interval '1 hour'`;
}
