import crypto from "node:crypto";
import { env } from "./env";

/**
 * Criptografia de campos (dados pessoais, QR Codes, identificadores de login).
 *
 * - AES-256-GCM (confidencialidade + integridade). IV aleatório de 12 bytes por valor.
 * - AAD = contexto (ex.: "usuarios.email"): um valor cifrado numa coluna NÃO abre em outra.
 * - Rotação de chave: DATA_ENCRYPTION_KEYS = "k2:<base64>,k1:<base64>" (a primeira cifra; todas decifram).
 * - "Blind index" (HMAC-SHA256 com chave própria) permite buscar/impor unicidade sem guardar o valor em claro.
 *
 * Formato do texto cifrado:  v1.<idDaChave>.<iv>.<tag>.<dados>   (base64url)
 */

const VERSAO = "v1";
const ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

type Material = { atual: { id: string; key: Buffer }; todas: Map<string, Buffer>; indice: Buffer };
let cache: Material | null = null;

function chave32(b64: string, nome: string): Buffer {
  const b = Buffer.from(b64, "base64");
  if (b.length !== 32) throw new Error(`${nome} deve ter exatamente 32 bytes em base64 (gere com: openssl rand -base64 32)`);
  return b;
}

function carregar(): Material {
  if (cache) return cache;
  const e = env();
  const todas = new Map<string, Buffer>();
  let atual: Material["atual"] | null = null;
  for (const par of e.DATA_ENCRYPTION_KEYS.split(",").map((s) => s.trim()).filter(Boolean)) {
    const i = par.indexOf(":");
    const id = par.slice(0, i);
    if (i < 1 || !ID_RE.test(id)) throw new Error('DATA_ENCRYPTION_KEYS inválida: use "id:base64,id:base64"');
    if (todas.has(id)) throw new Error(`DATA_ENCRYPTION_KEYS: id de chave repetido (${id})`);
    const key = chave32(par.slice(i + 1), `Chave ${id}`);
    todas.set(id, key);
    atual ??= { id, key };
  }
  if (!atual) throw new Error("DATA_ENCRYPTION_KEYS vazia");
  const indice = chave32(e.BLIND_INDEX_KEY, "BLIND_INDEX_KEY");
  if (todas.size && [...todas.values()].some((k) => k.equals(indice))) {
    throw new Error("BLIND_INDEX_KEY deve ser diferente das chaves de criptografia");
  }
  cache = { atual, todas, indice };
  return cache;
}

/** Só para testes. */
export function _resetarCacheCripto() { cache = null; }

const b64u = (b: Buffer) => b.toString("base64url");

export function cifrar(texto: string, contexto: string): string {
  const { atual } = carregar();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", atual.key, iv);
  c.setAAD(Buffer.from(contexto));
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [VERSAO, atual.id, b64u(iv), b64u(c.getAuthTag()), b64u(dados)].join(".");
}

export function decifrar(blob: string, contexto: string): string {
  const { todas } = carregar();
  const p = blob.split(".");
  if (p.length !== 5 || p[0] !== VERSAO) throw new Error("Falha ao decifrar");
  const key = todas.get(p[1]);
  if (!key) throw new Error("Falha ao decifrar");
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(p[2], "base64url"));
    d.setAAD(Buffer.from(contexto));
    d.setAuthTag(Buffer.from(p[3], "base64url"));
    return Buffer.concat([d.update(Buffer.from(p[4], "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Falha ao decifrar"); // sem detalhes: não vaza nada ao atacante
  }
}

export const cifrarOpt = (t: string | null | undefined, ctx: string) => (t == null || t === "" ? null : cifrar(t, ctx));
export const decifrarOpt = (b: string | null | undefined, ctx: string) => (b == null || b === "" ? null : decifrar(b, ctx));
export const estaCifrado = (s: string | null | undefined) => !!s && s.startsWith(`${VERSAO}.`) && s.split(".").length === 5;
/** true se o valor foi cifrado com uma chave que não é mais a atual (candidato a re-cifrar na rotação). */
export const precisaRotacionar = (blob: string) => blob.split(".")[1] !== carregar().atual.id;

// --- Blind index (busca exata e unicidade sem texto em claro)
export function indiceCego(valorNormalizado: string, contexto: string): string {
  return crypto.createHmac("sha256", carregar().indice).update(`${contexto}\0${valorNormalizado}`).digest("hex");
}

export const normalizarEmail = (e: string) => e.trim().toLowerCase();
/** Só dígitos; assume Brasil (+55) quando vier com 10/11 dígitos. Ajuste se o app tiver outros países. */
export function normalizarTelefone(t: string): string {
  const d = t.replace(/\D/g, "").replace(/^00/, "");
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

export const hashEmail = (email: string) => indiceCego(normalizarEmail(email), "email");
export const hashTelefone = (tel: string) => indiceCego(normalizarTelefone(tel), "telefone");
/** Token de QR Code: o banco guarda só este hash; o valor em claro existe apenas no QR e na resposta de criação. */
export const hashTokenQr = (token: string) => indiceCego(token, "qr.token");
/** Chave para rate limit: nunca grave e-mail/IP em claro na tabela de contadores. */
export const chaveRateLimit = (valor: string) => indiceCego(valor.toLowerCase(), "rate").slice(0, 32);

// --- Payload selado e opaco (ex.: QR de identificação do cliente): cifrado, autenticado e com validade
export function selar(dados: Record<string, unknown>, contexto: string, ttlSeg: number): string {
  return cifrar(JSON.stringify({ ...dados, exp: Math.floor(Date.now() / 1000) + ttlSeg }), `selo:${contexto}`);
}
export function abrir<T extends Record<string, unknown>>(token: string, contexto: string): (T & { exp: number }) | null {
  try {
    const o = JSON.parse(decifrar(token, `selo:${contexto}`)) as T & { exp: number };
    return typeof o.exp === "number" && o.exp >= Math.floor(Date.now() / 1000) ? o : null;
  } catch {
    return null;
  }
}

// --- Máscaras para logs/auditoria (nunca registre e-mail/telefone inteiros)
export function mascararEmail(e: string): string {
  const [u = "", d = ""] = e.split("@");
  return `${u.slice(0, 1)}***@${d}`;
}
export function mascararTelefone(t: string): string {
  const d = t.replace(/\D/g, "");
  return d.length >= 4 ? `***${d.slice(-4)}` : "***";
}
