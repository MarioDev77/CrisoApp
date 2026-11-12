import { createHash } from "node:crypto";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { chaveRateLimit } from "./crypto";
import { env } from "./env";

export type Regra = { nome: string; max: number; janelaSeg: number; msg?: string };
export type Contagem = { contagem: number; ttl: number };

/**
 * FONTE ÚNICA DE VERDADE: PostgreSQL. Não há contador em memória (antes havia um Map por processo que divergia
 * do banco e bloqueava indevidamente). Cada operação é UMA instrução atômica, então vale entre instâncias e
 * processos. O relógio é o do banco (now()), nunca o do processo.
 * A chave gravada é HMAC: nem IP nem e-mail aparecem em claro na tabela rate_limits.
 */
function chavePersistida(nome: string, id: string): string {
  const logica = `${nome}:${id}`;
  const e = env();
  const ident = e.DATA_ENCRYPTION_KEYS && e.BLIND_INDEX_KEY ? chaveRateLimit(logica) : createHash("sha256").update(logica.toLowerCase()).digest("hex").slice(0, 32);
  return `${nome}:${ident}`;
}

/** Soma 1 à janela (cria ou renova se vencida) e devolve a contagem. Não lança: quem decide é o chamador. */
export async function contar(regra: Pick<Regra, "nome" | "janelaSeg">, id: string): Promise<Contagem> {
  const chave = chavePersistida(regra.nome, id);
  const rows = await prisma().$queryRaw<Contagem[]>`
    INSERT INTO rate_limits (chave, contagem, expira_em)
    VALUES (${chave}, 1, now() + make_interval(secs => ${regra.janelaSeg}))
    ON CONFLICT (chave) DO UPDATE SET
      contagem = CASE WHEN rate_limits.expira_em <= now() THEN 1 ELSE rate_limits.contagem + 1 END,
      expira_em = CASE WHEN rate_limits.expira_em <= now()
                       THEN now() + make_interval(secs => ${regra.janelaSeg})
                       ELSE rate_limits.expira_em END
    RETURNING contagem, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expira_em - now()))))::int AS ttl`;
  return rows[0];
}

export const msgPadrao = "Muitas requisições. Tente novamente em instantes.";

/** Conta e lança 429 com Retry-After (segundos restantes da janela) quando passa do máximo. */
export async function limitar(regra: Regra, id: string, _legado = false): Promise<Contagem> {
  const r = await contar(regra, id);
  if (r.contagem > regra.max) throw new HttpError(429, regra.msg ?? msgPadrao, { retryAfter: Math.max(1, r.ttl) });
  return r;
}

/** Devolve 1 tentativa (ex.: login que deu certo não conta como falha). Nunca fica abaixo de zero. */
export async function estornar(regra: Pick<Regra, "nome">, id: string): Promise<void> {
  const chave = chavePersistida(regra.nome, id);
  await prisma().$executeRaw`UPDATE rate_limits SET contagem = GREATEST(contagem - 1, 0) WHERE chave = ${chave} AND expira_em > now()`;
}

/** Zera o contador (ex.: senha correta prova que quem tenta é o dono). */
export async function zerar(regra: Pick<Regra, "nome">, id: string): Promise<void> {
  const chave = chavePersistida(regra.nome, id);
  await prisma().$executeRaw`DELETE FROM rate_limits WHERE chave = ${chave}`;
}

/** Prolonga a janela atual (contenção progressiva). Devolve os segundos restantes. */
export async function estenderJanela(regra: Pick<Regra, "nome">, id: string, segundos: number): Promise<number> {
  const chave = chavePersistida(regra.nome, id);
  const rows = await prisma().$queryRaw<{ ttl: number }[]>`
    UPDATE rate_limits SET expira_em = now() + make_interval(secs => ${segundos}) WHERE chave = ${chave}
    RETURNING GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expira_em - now()))))::int AS ttl`;
  return rows[0]?.ttl ?? segundos;
}

/** Remove contadores vencidos; executado pelo endpoint de manutenção protegido. */
export async function limparExpirados(): Promise<number> {
  return prisma().$executeRaw`DELETE FROM rate_limits WHERE expira_em < now() - interval '1 hour'`;
}
