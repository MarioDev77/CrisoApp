import { prisma } from "./db";
import { auditar } from "./servicos";

/**
 * Auditoria de alterações administrativas com valor ANTERIOR e POSTERIOR, gravada na MESMA transação da alteração
 * (sem a mudança não há registro e sem o registro não há mudança). Só registra campos que mudaram.
 */
const fmt = (v: unknown): string => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t === undefined ? "∅" : t.length > 120 ? `${t.slice(0, 117)}...` : t;
};
const plano = (o: unknown): Record<string, unknown> => (o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {});

export function descreverMudanca(antes: unknown, depois: unknown): string {
  const a = plano(antes), d = plano(depois);
  const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])].sort();
  const mudou = campos.filter((c) => JSON.stringify(a[c]) !== JSON.stringify(d[c]));
  if (mudou.length === 0) return "sem alteração de valores";
  return mudou.map((c) => `${c}: ${fmt(a[c])} → ${fmt(d[c])}`).join("; ");
}

/** Grava a configuração e a auditoria (antes → depois) atomicamente. A linha é travada para dois admins não gerarem "antes" falso. */
export async function alterarConfiguracao(a: { chave: string; valor: Record<string, unknown>; acao: string; usuarioId: number; ip: string }): Promise<void> {
  await prisma().$transaction(async (tx) => {
    const atual = await tx.$queryRaw<{ valor: unknown }[]>`SELECT valor FROM configuracoes WHERE chave = ${a.chave} FOR UPDATE`;
    await tx.configuracao.upsert({ where: { chave: a.chave }, create: { chave: a.chave, valor: a.valor as object }, update: { valor: a.valor as object } });
    await auditar(a.acao, `${a.chave}: ${descreverMudanca(atual[0]?.valor, a.valor)}`, a.ip, a.usuarioId, tx);
  });
}
