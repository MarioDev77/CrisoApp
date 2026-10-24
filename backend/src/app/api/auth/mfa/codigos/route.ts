import { z } from "zod";
import { api } from "@/lib/api";
import { compararSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { decifrarSegredoTotp, verificarTotp } from "@/lib/mfa";
import { buscarMfa, contaDoPerfil, listarCodigosRecuperacao, substituirCodigosRecuperacao } from "@/lib/mfa-codigos";

const body = z.object({
  senha: z.string().max(200).optional(),
  codigo: z.string().trim().max(6).optional(), // contas sem senha (login só com Google) confirmam com o código do autenticador
  acao: z.enum(["listar", "regenerar"]).default("listar"),
});

// Rever ou regenerar os códigos de recuperação: só com MFA já validado e confirmação de identidade (senha ou código).
export const POST = api({ auth: ["cliente", "loja", "admin"], body, limites: [{ nome: "mfa-codigos", por: "usuario", max: 10, janelaSeg: 900 }] }, async ({ usuario, body }) => {
  const mfa = await buscarMfa(contaDoPerfil(usuario));
  if (!mfa?.habilitado) throw new HttpError(409, "Ative o segundo fator antes de ver os códigos de recuperação.");
  const conta = usuario.tipo === "loja"
    ? await prisma().loja.findUniqueOrThrow({ where: { id: usuario.id }, select: { senha: true } })
    : await prisma().usuario.findUniqueOrThrow({ where: { id: usuario.id }, select: { senha: true } });
  if (conta.senha) {
    if (!body.senha) throw new HttpError(400, "Confirme sua senha.");
    if (!(await compararSenha(body.senha, conta.senha))) throw new HttpError(401, "Senha incorreta.");
  } else {
    let ok = false;
    try { ok = verificarTotp(decifrarSegredoTotp(mfa.segredoEnc), body.codigo ?? ""); } catch { ok = false; }
    if (!ok) throw new HttpError(401, "Código do autenticador incorreto.");
  }
  if (body.acao === "regenerar") await substituirCodigosRecuperacao(mfa.id);
  return { sucesso: true, codigos: await listarCodigosRecuperacao(mfa.id) };
});
