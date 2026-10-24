import { z } from "zod";
import { api } from "@/lib/api";
import { hashSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { email, senhaNova, telefoneSchema } from "@/lib/schemas";
import { respostaComSessao } from "@/lib/sessao";
import { mfaObrigatorio } from "@/lib/mfa";
import { Prisma } from "@/generated/prisma/client";
import { buscarLojaPorEmail, buscarUsuarioPorEmail, camposEmailUsuario, camposTelefoneUsuario } from "@/lib/pii";

const body = z.object({
  nome: z.string({ error: "Preencha nome, e-mail e senha" }).trim().min(1, "Preencha nome, e-mail e senha").max(120),
  email,
  senha: senhaNova,
  telefone: telefoneSchema,
});

export const POST = api(
  { auth: false, body, limites: [
    { nome: "cadastro-ip", por: "ip", max: 30, janelaSeg: 900 },
    { nome: "cadastro", por: "ip+email", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
    { nome: "cadastro-email", por: "email", max: 20, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
  ] },
  async ({ body }) => {
    const senha = await hashSenha(body.senha);
    const [u, l] = await Promise.all([
      buscarUsuarioPorEmail(prisma(), body.email),
      buscarLojaPorEmail(prisma(), body.email),
    ]);
    if (u || l) throw new HttpError(400, "Nao foi possivel completar o cadastro");
    try {
      const novo = await prisma().usuario.create({
        data: { nome: body.nome, ...camposEmailUsuario(body.email), senha, ...camposTelefoneUsuario(body.telefone), tipo: "cliente", status: "ativo" },
      });
      return respostaComSessao(
        { sucesso: true, perfil: { id: novo.id, nome: novo.nome, email: novo.email, tipo: "cliente" }, ...(mfaObrigatorio("cliente") ? { mfa_setup_required: true } : {}) },
        { id: novo.id, tipo: "cliente", versao: novo.versaoSessao },
        201,
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(400, "Nao foi possivel completar o cadastro");
      throw e;
    }
  },
);
