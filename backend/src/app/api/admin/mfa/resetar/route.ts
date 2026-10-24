import { z } from "zod";
import { api } from "@/lib/api";
import { compararSenha } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { auditar } from "@/lib/servicos";

const body = z.object({
  tipo: z.enum(["usuario", "loja"]),
  id: z.number().int().positive(),
  senha: z.string({ error: "Confirme sua senha." }).min(1, "Confirme sua senha.").max(200),
});

/**
 * Para quem perdeu o celular E os códigos de recuperação: remove o segundo fator da conta, encerra as sessões dela
 * e, no próximo login, a pessoa configura um autenticador novo. Exige a senha do admin; ninguém reseta o próprio MFA.
 */
export const POST = api({ auth: ["admin"], body, limites: [{ nome: "admin-mfa-resetar", por: "usuario", max: 10, janelaSeg: 900 }] }, async ({ usuario, body, ip }) => {
  if (body.tipo === "usuario" && body.id === usuario.id) throw new HttpError(400, "Você não pode resetar o seu próprio MFA.");
  const eu = await prisma().usuario.findUniqueOrThrow({ where: { id: usuario.id }, select: { senha: true } });
  if (!(await compararSenha(body.senha, eu.senha))) throw new HttpError(401, "Senha incorreta.");
  const alvo = body.tipo === "loja"
    ? await prisma().loja.findFirst({ where: { id: body.id, deletadoEm: null }, select: { id: true } })
    : await prisma().usuario.findFirst({ where: { id: body.id, deletadoEm: null }, select: { id: true } });
  if (!alvo) throw notFound("Conta não encontrada");
  await prisma().mfaConta.deleteMany({ where: { contaTipo: body.tipo, contaId: body.id } });
  if (body.tipo === "loja") await prisma().loja.update({ where: { id: body.id }, data: { versaoSessao: { increment: 1 } } });
  else await prisma().usuario.update({ where: { id: body.id }, data: { versaoSessao: { increment: 1 } } });
  await auditar("admin_resetou_mfa", `${body.tipo}_id=${body.id}`, ip, usuario.id);
  return { sucesso: true };
});
