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
