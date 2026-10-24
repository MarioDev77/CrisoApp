import { z } from "zod";
import { api } from "@/lib/api";
import { compararSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { email } from "@/lib/schemas";
import { respostaComSessao } from "@/lib/sessao";
import { buscarLojaPorEmail, buscarUsuarioPorEmail, emailDaLoja, emailDoUsuario } from "@/lib/pii";
import { exigirMfaNoLogin } from "@/lib/mfa-codigos";
import { enviarAvisoLoginAdmin } from "@/lib/email";
import { log } from "@/lib/log";
import { auditar } from "@/lib/servicos";

const body = z.object({ email, senha: z.string({ error: "Preencha e-mail e senha" }).min(1, "Preencha e-mail e senha").max(200), codigo_mfa: z.string().trim().max(32).optional() });

/** Passo de MFA do login; código digitado e recusado vira "login_mfa_falha" (o pedido do 1º código, sem digitar nada, não conta). */
async function mfaComAuditoria(conta: { tipo: "usuario" | "loja"; id: number }, perfil: string, codigo: string, ip: string, idAtor: number | null) {
  try {
    return await exigirMfaNoLogin(conta, perfil, codigo);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401 && codigo.trim()) await auditar("login_mfa_falha", `perfil=${perfil}${conta.tipo === "loja" ? ` loja_id=${conta.id}` : ""}`, ip, idAtor);
    throw e;
  }
}

export const POST = api(
  {
    auth: false,
    body,
    limites: [
      { nome: "login-ip", por: "ip", max: 60, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
      { nome: "login", por: "ip+email", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
      { nome: "login-email", por: "email", max: 20, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
    ],
  },
  async ({ body, ip }) => {
    const u = await buscarUsuarioPorEmail(prisma(), body.email);
    const l = u ? null : await buscarLojaPorEmail(prisma(), body.email);
    const conta = u ?? l;
    const ok = await compararSenha(body.senha, conta?.senha);
    if (!conta || !ok) {
      // Só registra quando a conta existe (senha errada): e-mail inexistente não gera linha, para o log não ser inundado.
      if (conta) await auditar("login_falha", `perfil=${u ? u.tipo : "loja"} motivo=senha`, ip, u?.id ?? null);
      throw new HttpError(401, "E-mail ou senha incorretos");
    }

    if (u) {
      if (u.deletadoEm || u.status !== "ativo") throw new HttpError(403, "Conta bloqueada ou inativa");
      const m = await mfaComAuditoria({ tipo: "usuario", id: u.id }, u.tipo, body.codigo_mfa ?? "", ip, u.id);
      await auditar("login_sucesso", `perfil=${u.tipo} mfa=${m.mfa}`, ip, u.id);
      await prisma().usuario.update({ where: { id: u.id }, data: { ultimoLogin: new Date() } });
      if (u.tipo === "admin") {
        try { await enviarAvisoLoginAdmin(emailDoUsuario(u), u.nome); }
        catch (e) { log.error("falha_envio_alerta_login_admin", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
      }
      return respostaComSessao(
        { sucesso: true, perfil: { id: u.id, nome: u.nome, email: emailDoUsuario(u), tipo: u.tipo }, ...(m.setup ? { mfa_setup_required: true } : {}) },
        { id: u.id, tipo: u.tipo, versao: u.versaoSessao, mfa: m.mfa },
      );
    }
    const loja = l!;
    if (loja.deletadoEm || loja.status === "inativo") throw new HttpError(403, "Conta bloqueada ou inativa");
    if (loja.status === "pendente") throw new HttpError(403, "Cadastro da loja aguardando aprovação");
    const m = await mfaComAuditoria({ tipo: "loja", id: loja.id }, "loja", body.codigo_mfa ?? "", ip, null);
    // idCliente é FK de usuarios: a loja entra no texto, não na coluna.
    await auditar("login_sucesso", `perfil=loja loja_id=${loja.id} mfa=${m.mfa}`, ip, null);
    return respostaComSessao(
      { sucesso: true, perfil: { id: loja.id, nome: loja.nome, email: emailDaLoja(loja), tipo: "loja", id_loja: loja.id }, ...(m.setup ? { mfa_setup_required: true } : {}) },
      { id: loja.id, tipo: "loja", versao: loja.versaoSessao, mfa: m.mfa },
    );
  },
);
