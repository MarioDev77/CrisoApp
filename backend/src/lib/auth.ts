import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { env } from "./env";
import { prisma } from "./db";
import { unauthorized, forbidden } from "./errors";

export type Perfil = "cliente" | "admin" | "loja";
export type Principal = { id: number; tipo: Perfil; nome: string; email: string };

export const COOKIE = "crisoverde_session";
const SESSAO_SEG = 8 * 60 * 60;
const key = () => new TextEncoder().encode(env().JWT_SECRET);

export async function emitirSessao(p: { id: number; tipo: Perfil; versao: number }) {
  return new SignJWT({ tipo: p.tipo, v: p.versao })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(p.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSAO_SEG}s`)
    .sign(key());
}

export function opcoesCookie(maxAge = SESSAO_SEG) {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

/** Lê o token do cookie HttpOnly ou (somente se LEGACY_BEARER=true) do cabeçalho Authorization. */
function lerToken(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (m) return decodeURIComponent(m[1]);
  if (env().LEGACY_BEARER) {
    const h = req.headers.get("authorization");
    if (h?.startsWith("Bearer ")) return h.slice(7);
  }
  return null;
}

/**
 * Valida a assinatura E o estado atual no banco (status, exclusão, versão da sessão).
 * É isto que faz bloqueio, exclusão, troca de senha e loja pendente valerem imediatamente.
 */
export async function autenticar(req: Request): Promise<Principal> {
  const token = lerToken(req);
  if (!token) throw unauthorized();
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] }));
  } catch {
    throw unauthorized("Sessão inválida ou expirada");
  }
  const id = Number(payload.sub);
  const tipo = payload.tipo as Perfil;
  const v = Number(payload.v);
  if (!Number.isInteger(id) || !["cliente", "admin", "loja"].includes(tipo)) throw unauthorized();

  if (tipo === "loja") {
    const l = await prisma().loja.findUnique({ where: { id } });
    if (!l || l.deletadoEm || l.status !== "ativo" || l.versaoSessao !== v) throw unauthorized("Sessão encerrada");
    return { id, tipo, nome: l.nome, email: l.email };
  }
  const u = await prisma().usuario.findUnique({ where: { id } });
  if (!u || u.deletadoEm || u.status !== "ativo" || u.versaoSessao !== v || u.tipo !== tipo) {
    throw unauthorized("Sessão encerrada");
  }
  return { id, tipo, nome: u.nome, email: u.email };
}

export function exigir(p: Principal, ...tipos: Perfil[]) {
  if (!tipos.includes(p.tipo)) throw forbidden();
}

// --- senhas
const COST = 12;
export const hashSenha = (s: string) => bcrypt.hash(s, COST);
let dummy: Promise<string> | null = null;
/** Compara contra um hash falso quando o usuário não existe, igualando o tempo de resposta. */
export async function compararSenha(senha: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    dummy ??= bcrypt.hash(crypto.randomBytes(16).toString("hex"), COST);
    await bcrypt.compare(senha, await dummy);
    return false;
  }
  return bcrypt.compare(senha, hash);
}

// --- token curto de redefinição de senha
export async function emitirResetToken(usuarioId: number, versao: number) {
  return new SignJWT({ fim: "reset", v: versao })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(usuarioId))
    .setExpirationTime("10m")
    .sign(key());
}
export async function lerResetToken(token: string): Promise<{ id: number; v: number } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.fim !== "reset") return null;
    return { id: Number(payload.sub), v: Number(payload.v) };
  } catch {
    return null;
  }
}

export const hashCodigo = (codigo: string) =>
  crypto.createHmac("sha256", env().JWT_SECRET).update(`reset:${codigo}`).digest("hex");

// --- identificador temporário do cliente (QR "meu-qr", 90 s)
const assinar = (dado: string) => crypto.createHmac("sha256", env().JWT_SECRET).update(`cli:${dado}`).digest("hex").slice(0, 32);
export function gerarIdentificadorCliente(id: number) {
  const exp = Math.floor(Date.now() / 1000) + 90;
  return `${id}.${exp}.${assinar(`${id}.${exp}`)}`;
}
export function verificarIdentificadorCliente(valor: string): number | null {
  const [id, exp, sig] = valor.split(".");
  if (!id || !exp || !sig) return null;
  const esperado = assinar(`${id}.${exp}`);
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}
