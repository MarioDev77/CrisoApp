import { z } from "zod";
import { api } from "@/lib/api";
import { compararSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { email } from "@/lib/schemas";
import { respostaComSessao } from "@/lib/sessao";

const body = z.object({ email, senha: z.string({ error: "Preencha e-mail e senha" }).min(1, "Preencha e-mail e senha").max(200) });

export const POST = api(
  {
    auth: false,
    body,
    limites: [
      { nome: "login-ip", por: "ip", max: 60, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
      { nome: "login", por: "ip+email", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
    ],
  },
  async ({ body }) => {
    const u = await prisma().usuario.findUnique({ where: { email: body.email } });
    const l = u ? null : await prisma().loja.findUnique({ where: { email: body.email } });
    const conta = u ?? l;
    if (conta && !conta.senha) {
      throw new HttpError(401, 'Esta conta usa login com Google. Entre com o botão "Continuar com Google".');
    }
    const ok = await compararSenha(body.senha, conta?.senha);
    if (!conta || !ok) throw new HttpError(401, "E-mail ou senha incorretos");

    if (u) {
      if (u.deletadoEm || u.status !== "ativo") throw new HttpError(403, "Conta bloqueada ou inativa");
      await prisma().usuario.update({ where: { id: u.id }, data: { ultimoLogin: new Date() } });
      return respostaComSessao(
        { sucesso: true, perfil: { id: u.id, nome: u.nome, email: u.email, tipo: u.tipo } },
        { id: u.id, tipo: u.tipo, versao: u.versaoSessao },
      );
    }
    const loja = l!;
    if (loja.deletadoEm || loja.status === "inativo") throw new HttpError(403, "Conta bloqueada ou inativa");
    if (loja.status === "pendente") throw new HttpError(403, "Cadastro da loja aguardando aprovação");
    return respostaComSessao(
      { sucesso: true, perfil: { id: loja.id, nome: loja.nome, email: loja.email, tipo: "loja", id_loja: loja.id } },
      { id: loja.id, tipo: "loja", versao: loja.versaoSessao },
    );
  },
);
