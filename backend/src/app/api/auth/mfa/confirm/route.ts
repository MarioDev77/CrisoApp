import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { decifrarSegredoTotp, verificarTotp } from "@/lib/mfa";
import { VALIDADE_SEGREDO_PENDENTE_MS, buscarMfa, contaDoPerfil, substituirCodigosRecuperacao } from "@/lib/mfa-codigos";
import { respostaComSessao } from "@/lib/sessao";
import { auditar } from "@/lib/servicos";
import { enviarAvisoMfaAdmin } from "@/lib/email";
import { log } from "@/lib/log";

const body = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Informe o código de 6 dígitos.") });
export const POST = api({ auth: ["cliente", "loja", "admin"], body, limites: [{ nome: "mfa-confirm", por: "usuario", max: 10, janelaSeg: 900 }] }, async ({ usuario, body, ip }) => {
  const mfa = await buscarMfa(contaDoPerfil(usuario));
  if (!mfa || mfa.habilitado) throw new HttpError(409, "Inicie a configuração do segundo fator novamente.");
  if (Date.now() - mfa.atualizadoEm.getTime() > VALIDADE_SEGREDO_PENDENTE_MS) throw new HttpError(409, "A configuração expirou. Inicie o cadastro do autenticador novamente.");
  if (!verificarTotp(decifrarSegredoTotp(mfa.segredoEnc), body.codigo)) throw new HttpError(400, "Código MFA incorreto.");
  const codigos = await substituirCodigosRecuperacao(mfa.id);
  await prisma().mfaConta.update({ where: { id: mfa.id }, data: { habilitado: true, recoveryHashes: [] } });
  // Ativar o segundo fator encerra TODAS as outras sessões da conta (incrementa a versão): quem entrou só com a senha
  // antes disso perde o acesso. A sessão atual recebe a versão nova abaixo.
  const versao = usuario.tipo === "loja"
    ? (await prisma().loja.update({ where: { id: usuario.id }, data: { versaoSessao: { increment: 1 } }, select: { versaoSessao: true } })).versaoSessao
    : (await prisma().usuario.update({ where: { id: usuario.id }, data: { versaoSessao: { increment: 1 } }, select: { versaoSessao: true } })).versaoSessao;
  await auditar("mfa_ativado", `perfil=${usuario.tipo}${usuario.tipo === "loja" ? ` loja_id=${usuario.id}` : ""}`, ip, usuario.tipo === "loja" ? null : usuario.id);
  if (usuario.tipo === "admin") {
    try { await enviarAvisoMfaAdmin(usuario.email, usuario.nome, "ativado"); }
    catch (e) { log.error("falha_envio_alerta_mfa_admin", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
  }
  return respostaComSessao({ sucesso: true, mensagem: "Segundo fator ativado.", codigos_recuperacao: codigos }, { id: usuario.id, tipo: usuario.tipo, versao, mfa: true });
});
