import { prisma } from "./db";
import { HttpError } from "./errors";
import { limitar } from "./rate-limit";
import {
  cifrarCodigoRecuperacao,
  decifrarCodigoRecuperacao,
  decifrarSegredoTotp,
  hashRecoveryCode,
  mfaObrigatorio,
  novosCodigosRecuperacao,
  verificarTotp,
} from "./mfa";

/** cliente e admin vivem em `usuarios`; loja tem tabela própria (ids independentes), por isso o tipo na chave. */
export type ContaMfa = { tipo: "usuario" | "loja"; id: number };
export const contaDoPerfil = (p: { tipo: string; id: number }): ContaMfa => ({ tipo: p.tipo === "loja" ? "loja" : "usuario", id: p.id });

export const buscarMfa = (c: ContaMfa) => prisma().mfaConta.findUnique({ where: { contaTipo_contaId: { contaTipo: c.tipo, contaId: c.id } } });

/** Substitui todos os códigos da conta por um conjunto novo e devolve o texto em claro (só para exibir agora). */
export async function substituirCodigosRecuperacao(mfaId: number): Promise<string[]> {
  const { codes } = novosCodigosRecuperacao();
  await prisma().$transaction([
    prisma().mfaCodigo.deleteMany({ where: { mfaId } }),
    prisma().mfaCodigo.createMany({ data: codes.map((c) => ({ mfaId, codigoEnc: cifrarCodigoRecuperacao(c), codigoHash: hashRecoveryCode(c) })) }),
  ]);
  return codes;
}

export async function listarCodigosRecuperacao(mfaId: number) {
  const linhas = await prisma().mfaCodigo.findMany({ where: { mfaId }, orderBy: { id: "asc" } });
  return linhas.map((l) => ({ codigo: decifrarCodigoRecuperacao(l.codigoEnc), usado: l.usadoEm !== null }));
}

/** Consome um código de uso único de forma atômica. true = válido e agora marcado como usado. */
export async function consumirCodigoRecuperacao(mfaId: number, codigo: string): Promise<boolean> {
  const r = await prisma().mfaCodigo.updateMany({ where: { mfaId, codigoHash: hashRecoveryCode(codigo), usadoEm: null }, data: { usadoEm: new Date() } });
  return r.count === 1;
}

/**
 * Um código TOTP vale em 3 janelas de 30 s (até ~90 s). Sem esta trava, quem observa o código digitado
 * (ombro, malware, proxy) pode reutilizá-lo nesse intervalo. Reaproveita o contador atômico de rate limit
 * (tabela rate_limits, sem schema novo): o 1º uso do código passa, qualquer repetição em 2 min é recusada.
 * Só é chamada DEPOIS de o código ter sido validado, então digitar errado não "gasta" nada.
 */
export async function totpAindaNaoUsado(conta: ContaMfa, codigo: string): Promise<boolean> {
  try {
    await limitar({ nome: "totp-uso", max: 1, janelaSeg: 120 }, `${conta.tipo}:${conta.id}:${codigo}`);
    return true;
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) return false;
    throw e;
  }
}

/**
 * Passo de MFA do login (senha, loja ou Google já validados antes).
 * - MFA ativo: exige o código (TOTP ou recuperação) e devolve { mfa: true }.
 * - MFA ainda não ativo e obrigatório para o perfil: { setup: true } (sessão restrita até configurar).
 */
export async function exigirMfaNoLogin(conta: ContaMfa, tipoPerfil: string, codigo: string): Promise<{ mfa: boolean; setup: boolean }> {
  // Cliente não usa MFA: nunca pede código nem configuração, mesmo que exista registro antigo.
  if (tipoPerfil === "cliente") return { mfa: false, setup: false };
  const mfa = await buscarMfa(conta);
  if (!mfa?.habilitado) return { mfa: false, setup: mfaObrigatorio(tipoPerfil) };
  const code = codigo.trim();
  if (!code) throw new HttpError(401, "Informe o código do aplicativo autenticador.", { mfa_required: true });
  let valido = false;
  try { valido = verificarTotp(decifrarSegredoTotp(mfa.segredoEnc), code); } catch { valido = false; }
  if (valido && !(await totpAindaNaoUsado(conta, code))) valido = false; // replay do mesmo código
  if (!valido) valido = await consumirCodigoRecuperacao(mfa.id, code);
  if (!valido) {
    // Compatibilidade: códigos antigos guardados só como hash (antes da tabela de códigos).
    const hash = hashRecoveryCode(code);
    if (mfa.recoveryHashes.includes(hash)) {
      const r = await prisma().mfaConta.updateMany({ where: { id: mfa.id, habilitado: true, recoveryHashes: { has: hash } }, data: { recoveryHashes: mfa.recoveryHashes.filter((x) => x !== hash) } });
      valido = r.count === 1;
    }
  }
  if (!valido) throw new HttpError(401, "Código MFA incorreto ou já utilizado.", { mfa_required: true });
  return { mfa: true, setup: false };
}
