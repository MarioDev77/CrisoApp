import { z } from "zod";
import { api } from "@/lib/api";
import { compararSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { email, telefoneSchema } from "@/lib/schemas";
import { normalizarEmail } from "@/lib/crypto";
import { perfilCompleto } from "@/lib/perfil";
import { buscarLojaPorEmail, buscarUsuarioPorEmail, camposEmailUsuario, camposTelefoneUsuario, emailDoUsuario, telefoneDoUsuario } from "@/lib/pii";
import { auditar } from "@/lib/servicos";
import { Prisma } from "@/generated/prisma/client";

const body = z.object({
  nome: z.string({ error: "Informe seu nome" }).trim().min(2, "Informe seu nome").max(120),
  email,
  telefone: telefoneSchema.refine((t) => t !== "", "Informe seu celular com DDD."),
  senha_atual: z.string().max(72).optional(),
});

const visao = (u: Prisma.UsuarioGetPayload<object>) => ({
  nome: u.nome,
  email: emailDoUsuario(u),
  telefone: telefoneDoUsuario(u),
  provider: u.provider,
  perfil_completo: perfilCompleto(u),
});

export const GET = api({ auth: ["cliente"] }, async ({ usuario }) => {
  const u = await prisma().usuario.findFirst({ where: { id: usuario.id, tipo: "cliente", deletadoEm: null } });
  if (!u) throw notFound("Conta não encontrada.");
  return visao(u);
});

export const PUT = api(
  { auth: ["cliente"], body, limites: [{ nome: "perfil-atualizar", por: "usuario", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." }] },
  async ({ usuario, body, ip }) => {
    const db = prisma();
    const u = await db.usuario.findFirst({ where: { id: usuario.id, tipo: "cliente", status: "ativo", deletadoEm: null } });
    if (!u) throw notFound("Conta não encontrada.");

    const dados: Prisma.UsuarioUpdateInput = { nome: body.nome, ...camposTelefoneUsuario(body.telefone) };
    const mudouEmail = normalizarEmail(emailDoUsuario(u)) !== normalizarEmail(body.email);

    if (mudouEmail) {
      // O e-mail é o login da conta: trocar exige a senha atual e não vale para contas Google.
      if (u.provider === "google") throw new HttpError(400, "O e-mail de contas Google não pode ser alterado aqui.");
      if (!body.senha_atual || !(await compararSenha(body.senha_atual, u.senha))) throw new HttpError(400, "Para trocar o e-mail, informe sua senha atual corretamente.");
      const [outroUsuario, outraLoja] = await Promise.all([buscarUsuarioPorEmail(db, body.email), buscarLojaPorEmail(db, body.email)]);
      if ((outroUsuario && outroUsuario.id !== u.id) || outraLoja) throw new HttpError(400, "Este e-mail não está disponível.");
      Object.assign(dados, camposEmailUsuario(body.email));
    }

    let atualizado;
    try { atualizado = await db.usuario.update({ where: { id: u.id }, data: dados }); }
    catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(400, "Este e-mail não está disponível.");
      throw e;
    }
    await auditar("perfil_atualizado", `email_alterado=${mudouEmail} completo=${perfilCompleto(atualizado)}`, ip, u.id);
    const v = visao(atualizado);
    return { sucesso: true, mensagem: v.perfil_completo ? "Perfil salvo. Resgates liberados!" : "Perfil salvo.", ...v };
  },
);
