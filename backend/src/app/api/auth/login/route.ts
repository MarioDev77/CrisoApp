import { z } from "zod";
import { api } from "@/lib/api";
import { compararSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { email } from "@/lib/schemas";
import { respostaComSessao } from "@/lib/sessao";
import { buscarLojaPorEmail, buscarUsuarioPorEmail, emailDaLoja, emailDoUsuario } from "@/lib/pii";
import { decifrarSegredoTotp, hashRecoveryCode, verificarTotp } from "@/lib/mfa";
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
      await prisma().usuario.update({ where: { id: u.id }, data: { ultimoLogin: new Date() } });
      if (u.tipo === "admin") {
        const mfa = await prisma().adminMfa.findUnique({ where: { usuarioId: u.id } });
        if (!mfa?.habilitado) {
          try { await enviarAvisoLoginAdmin(emailDoUsuario(u), u.nome); }
          catch (e) { log.error("falha_envio_alerta_login_admin", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
          return respostaComSessao(
            { sucesso: true, perfil: { id: u.id, nome: u.nome, email: emailDoUsuario(u), tipo: u.tipo }, mfa_setup_required: true },
            { id: u.id, tipo: "admin", versao: u.versaoSessao, mfa: false },
          );
        }
        const code = body.codigo_mfa ?? "";
        let valid = false;
        try { valid = verificarTotp(decifrarSegredoTotp(mfa.segredoEnc), code); } catch { valid = false; }
        if (!valid && code) {
          const recoveryHash = hashRecoveryCode(code);
          if (mfa.recoveryHashes.includes(recoveryHash)) {
            const restantes = mfa.recoveryHashes.filter((x) => x !== recoveryHash);
            const consumido = await prisma().adminMfa.updateMany({ where: { usuarioId: u.id, habilitado: true, recoveryHashes: { has: recoveryHash } }, data: { recoveryHashes: restantes } });
            valid = consumido.count === 1;
          }
        }
        if (!valid) throw new HttpError(401, "Código MFA obrigatório ou inválido.");
        try { await enviarAvisoLoginAdmin(emailDoUsuario(u), u.nome); }
        catch (e) { log.error("falha_envio_alerta_login_admin", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
        return respostaComSessao(
          { sucesso: true, perfil: { id: u.id, nome: u.nome, email: emailDoUsuario(u), tipo: u.tipo } },
          { id: u.id, tipo: "admin", versao: u.versaoSessao, mfa: true },
        );
      }
      return respostaComSessao(
        { sucesso: true, perfil: { id: u.id, nome: u.nome, email: emailDoUsuario(u), tipo: u.tipo } },
        { id: u.id, tipo: u.tipo, versao: u.versaoSessao },
      );
    }
    const loja = l!;
    if (loja.deletadoEm || loja.status === "inativo") throw new HttpError(403, "Conta bloqueada ou inativa");
    if (loja.status === "pendente") throw new HttpError(403, "Cadastro da loja aguardando aprovação");
    return respostaComSessao(
      { sucesso: true, perfil: { id: loja.id, nome: loja.nome, email: emailDaLoja(loja), tipo: "loja", id_loja: loja.id } },
      { id: loja.id, tipo: "loja", versao: loja.versaoSessao },
    );
  },
);
