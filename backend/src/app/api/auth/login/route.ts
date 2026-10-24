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

const body = z.object({ email, senha: z.string({ error: "Preencha e-mail e senha" }).min(1, "Preencha e-mail e senha").max(200), codigo_mfa: z.string().trim().max(32).optional() });

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
  async ({ body }) => {
    const u = await buscarUsuarioPorEmail(prisma(), body.email);
    const l = u ? null : await buscarLojaPorEmail(prisma(), body.email);
    const conta = u ?? l;
    const ok = await compararSenha(body.senha, conta?.senha);
    if (!conta || !ok) throw new HttpError(401, "E-mail ou senha incorretos");

    if (u) {
      if (u.deletadoEm || u.status !== "ativo") throw new HttpError(403, "Conta bloqueada ou inativa");
      const m = await exigirMfaNoLogin({ tipo: "usuario", id: u.id }, u.tipo, body.codigo_mfa ?? "");
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
    const m = await exigirMfaNoLogin({ tipo: "loja", id: loja.id }, "loja", body.codigo_mfa ?? "");
    return respostaComSessao(
      { sucesso: true, perfil: { id: loja.id, nome: loja.nome, email: emailDaLoja(loja), tipo: "loja", id_loja: loja.id }, ...(m.setup ? { mfa_setup_required: true } : {}) },
      { id: loja.id, tipo: "loja", versao: loja.versaoSessao, mfa: m.mfa },
    );
  },
);
