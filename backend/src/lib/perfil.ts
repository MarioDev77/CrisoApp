import { normalizarTelefone } from "./crypto";
import { emailDoUsuario, telefoneDoUsuario } from "./pii";
import { EMAIL_RE } from "./schemas";

type UsuarioPerfil = { nome: string; email: string; emailEnc?: string | null; telefone?: string; telefoneEnc?: string | null };

export const MSG_PERFIL_INCOMPLETO = "Complete seu perfil (nome, e-mail e celular) para usar esta função.";

/**
 * Perfil completo = nome, e-mail válido e celular com DDD preenchidos.
 * Calculado na hora a partir dos dados da conta: não existe flag que possa ficar desatualizada.
 */
export function perfilCompleto(u: UsuarioPerfil): boolean {
  const telefone = normalizarTelefone(telefoneDoUsuario(u));
  return u.nome.trim().length >= 2 && EMAIL_RE.test(emailDoUsuario(u)) && /^\d{10,13}$/.test(telefone);
}

export const MSG_EMAIL_NAO_VERIFICADO = "Confirme seu e-mail para usar esta função.";
/** Operações que dependem de e-mail comprovado (resgate e confirmação de QR). Só barra quando EXIGIR_EMAIL_VERIFICADO=true. */
export function emailVerificadoOuErro(u: { emailVerificado: boolean }, exigir: boolean): { ok: true } | { ok: false; msg: string } {
  return exigir && !u.emailVerificado ? { ok: false, msg: MSG_EMAIL_NAO_VERIFICADO } : { ok: true };
}
