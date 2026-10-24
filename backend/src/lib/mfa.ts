import crypto from "node:crypto";
import { env } from "./env";
import { cifrar, decifrar } from "./crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function novoSegredoTotp() { return crypto.randomBytes(20); }
export function base32(buffer: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}
function deBase32(value: string) {
  let bits = 0, acc = 0;
  const out: number[] = [];
  for (const char of value.replace(/=+$/g, "").toUpperCase()) {
    const n = BASE32.indexOf(char);
    if (n < 0) throw new Error("Segredo TOTP inválido");
    acc = (acc << 5) | n; bits += 5;
    if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret: string, epoch: number) {
  const counter = Math.floor(epoch / 30);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", deBase32(secret)).update(msg).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}
export function verificarTotp(secret: string, code: string, agora = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  for (const delta of [-30, 0, 30]) {
    const esperado = totpAt(secret, Math.floor(agora / 1000) + delta);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(code))) return true;
  }
  return false;
}
export const cifrarSegredoTotp = (secret: string) => cifrar(secret, "admin_mfa.segredo");
export const decifrarSegredoTotp = (secret: string) => decifrar(secret, "admin_mfa.segredo");
export const hashRecoveryCode = (code: string) => crypto.createHmac("sha256", env().OTP_PEPPER || env().JWT_SECRET || "").update(`admin-recovery:${code.trim().toUpperCase()}`).digest("hex");
export function novosCodigosRecuperacao() {
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(6).toString("hex").toUpperCase());
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

// --- Códigos de recuperação guardados um a um (texto cifrado + hash para validação)
export const cifrarCodigoRecuperacao = (code: string) => cifrar(code, "admin_mfa_codigos.codigo");
export const decifrarCodigoRecuperacao = (blob: string) => decifrar(blob, "admin_mfa_codigos.codigo");

/** Admin sempre precisa de MFA; cliente e loja só quando MFA_ESCOPO=todos (padrão). */
export const mfaObrigatorio = (tipoPerfil: string) => tipoPerfil === "admin" || env().MFA_ESCOPO === "todos";
