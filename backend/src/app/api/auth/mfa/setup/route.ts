import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { env } from "@/lib/env";
import { base32, cifrarSegredoTotp, decifrarSegredoTotp, novoSegredoTotp } from "@/lib/mfa";
import { VALIDADE_SEGREDO_PENDENTE_MS, buscarMfa, contaDoPerfil } from "@/lib/mfa-codigos";
import { auditar } from "@/lib/servicos";
import { enviarAvisoMfaAdmin } from "@/lib/email";
import { log } from "@/lib/log";


const body = z.object({ regenerar: z.boolean().optional() });

export const POST = api({ auth: ["cliente", "loja", "admin"], body, limites: [{ nome: "mfa-setup", por: "usuario", max: 20, janelaSeg: 900 }] }, async ({ usuario, body, ip }) => {
  if (!env().DATA_ENCRYPTION_KEYS || !env().BLIND_INDEX_KEY) throw new HttpError(503, "Criptografia de MFA ainda não configurada no servidor.");
  const conta = contaDoPerfil(usuario);
  const existente = await buscarMfa(conta);
  if (existente?.habilitado) throw new HttpError(409, "Segundo fator já configurado.");

  // Reaproveita o segredo pendente: no celular a pessoa sai para o app autenticador e volta,
  // e a página recarrega. Gerar outro segredo a cada visita invalidaria a chave que ela acabou de copiar.
  let secret: string | null = null;
  const fresco = existente ? Date.now() - existente.atualizadoEm.getTime() < VALIDADE_SEGREDO_PENDENTE_MS : false;
  if (existente && !body.regenerar && fresco) {
    try { secret = decifrarSegredoTotp(existente.segredoEnc); } catch { secret = null; }
  }
  if (!secret) {
    secret = base32(novoSegredoTotp());
    const salvo = await prisma().mfaConta.upsert({
      where: { contaTipo_contaId: { contaTipo: conta.tipo, contaId: conta.id } },
      create: { contaTipo: conta.tipo, contaId: conta.id, segredoEnc: cifrarSegredoTotp(secret), habilitado: false },
      update: { segredoEnc: cifrarSegredoTotp(secret), habilitado: false, recoveryHashes: [] },
    });
    await prisma().mfaCodigo.deleteMany({ where: { mfaId: salvo.id } });
    // Novo segredo = novo cadastro de autenticador: fica no rastro e, para administrador, o dono é avisado por e-mail.
    await auditar("mfa_setup_iniciado", `perfil=${usuario.tipo}${usuario.tipo === "loja" ? ` loja_id=${usuario.id}` : ""}`, ip, usuario.tipo === "loja" ? null : usuario.id);
    if (usuario.tipo === "admin") {
      try { await enviarAvisoMfaAdmin(usuario.email, usuario.nome, "iniciado"); }
      catch (e) { log.error("falha_envio_alerta_mfa_admin", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
    }
  }
  const label = encodeURIComponent(`CrisoVerde:${usuario.email}`);
  const issuer = encodeURIComponent("CrisoVerde");
  return { sucesso: true, secret, otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
});
