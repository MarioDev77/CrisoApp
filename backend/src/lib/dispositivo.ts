import { timingSafeEqual } from "node:crypto";
import { indiceCego, normalizarEmail } from "./crypto";

/**
 * Cookie de "dispositivo conhecido": prova que este navegador já entrou com sucesso nesta conta.
 * Serve para o dono não ser trancado para fora quando um terceiro erra a senha de propósito (contenção de conta).
 * Não depende de IP (que na cadeia Vercel→Railway pode não ser confiável) e não precisa de tabela.
 * Conteúdo: só HMACs (BLIND_INDEX_KEY). Não guarda e-mail, IP nem identificador reversível. Não autentica ninguém.
 */
export const COOKIE_DISPOSITIVO = process.env.NODE_ENV === "production" ? "__Host-crisoverde_dispositivo" : "crisoverde_dispositivo";
export const DISPOSITIVO_TTL_SEG = 30 * 24 * 60 * 60;
const MAX_CONTAS = 5;

const idConta = (email: string) => indiceCego(normalizarEmail(email), "dispositivo.conta").slice(0, 32);
const assinar = (id: string, exp: number) => indiceCego(`${id}.${exp}`, "dispositivo.sig").slice(0, 32);
const iguais = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function tokens(cookieHeader: string | null | undefined, agora: number): string[] {
  const m = (cookieHeader ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE_DISPOSITIVO}=([^;]*)`));
  if (!m) return [];
  return m[1].split("~").filter((t) => {
    const [id, exp, sig] = t.split(".");
    const e = Number(exp);
    return Boolean(id && sig) && Number.isFinite(e) && e > agora && iguais(sig, assinar(id, e));
  }).slice(0, MAX_CONTAS);
}

export function dispositivoConhecido(cookieHeader: string | null | undefined, email: string, agora = Math.floor(Date.now() / 1000)): boolean {
  const id = idConta(email);
  return tokens(cookieHeader, agora).some((t) => t.startsWith(`${id}.`));
}

/** Valor novo do cookie: renova o token desta conta e preserva os válidos das outras (máx. 5). */
export function valorDispositivo(cookieHeader: string | null | undefined, email: string, agora = Math.floor(Date.now() / 1000)): string {
  const id = idConta(email);
  const exp = agora + DISPOSITIVO_TTL_SEG;
  const outros = tokens(cookieHeader, agora).filter((t) => !t.startsWith(`${id}.`));
  return [`${id}.${exp}.${assinar(id, exp)}`, ...outros].slice(0, MAX_CONTAS).join("~");
}

export const opcoesCookieDispositivo = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: DISPOSITIVO_TTL_SEG,
});
