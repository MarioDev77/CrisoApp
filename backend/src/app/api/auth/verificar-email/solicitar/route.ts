import crypto from "node:crypto";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hashCodigoVerificacao } from "@/lib/auth";
import { enviarCodigoVerificacao } from "@/lib/email";
import { HttpError } from "@/lib/errors";
import { emailDoUsuario } from "@/lib/pii";
import { log } from "@/lib/log";

export const POST = api({ auth: ["cliente"], limites: [{ nome: "email-verificacao", por: "usuario", max: 3, janelaSeg: 3600 }] }, async ({ usuario }) => {
  const u = await prisma().usuario.findUnique({ where: { id: usuario.id } });
  if (!u || u.deletadoEm || u.status !== "ativo") throw new HttpError(404, "Conta não encontrada.");
  if (u.emailVerificado) return { sucesso: true, mensagem: "E-mail já confirmado." };
  const email = emailDoUsuario(u);
  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma().$transaction([
    prisma().emailVerificationCode.updateMany({ where: { usuarioId: u.id, utilizado: false }, data: { utilizado: true } }),
    prisma().emailVerificationCode.create({ data: { usuarioId: u.id, codigoHash: hashCodigoVerificacao(codigo), expiraEm: new Date(Date.now() + 10 * 60_000) } }),
  ]);
  try { await enviarCodigoVerificacao(email, u.nome, codigo); }
  catch (e) { log.error("falha_envio_verificacao_email", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
  return { sucesso: true, mensagem: "Se o envio estiver disponível, você receberá um código em instantes." };
});
