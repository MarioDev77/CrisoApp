import crypto from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { hashCodigoVerificacao } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";

const body = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Informe o código de 6 dígitos.") });
const iguais = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const POST = api({ auth: ["cliente"], body, limites: [{ nome: "email-verificacao-confirmar", por: "usuario", max: 10, janelaSeg: 900 }] }, async ({ usuario, body }) => {
  const db = prisma();
  const u = await db.usuario.findUnique({ where: { id: usuario.id }, select: { id: true, emailVerificado: true, deletadoEm: true, status: true } });
  if (!u || u.deletadoEm || u.status !== "ativo") throw new HttpError(404, "Conta não encontrada.");
  if (u.emailVerificado) return { sucesso: true, mensagem: "E-mail já confirmado." };
  const code = await db.emailVerificationCode.findFirst({ where: { usuarioId: u.id, utilizado: false }, orderBy: { criadoEm: "desc" } });
  if (!code || code.expiraEm < new Date()) throw new HttpError(400, "Código inválido ou expirado. Solicite outro código.");
  const reserva = await db.emailVerificationCode.updateMany({ where: { id: code.id, utilizado: false, tentativas: { lt: 5 } }, data: { tentativas: { increment: 1 } } });
  if (!reserva.count) throw new HttpError(429, "Número máximo de tentativas excedido. Solicite outro código.");
  if (!iguais(hashCodigoVerificacao(body.codigo), code.codigoHash)) throw new HttpError(400, "Código incorreto.");
  await db.$transaction([
    db.usuario.update({ where: { id: u.id }, data: { emailVerificado: true } }),
    db.emailVerificationCode.updateMany({ where: { usuarioId: u.id, utilizado: false }, data: { utilizado: true } }),
  ]);
  return { sucesso: true, mensagem: "E-mail confirmado com sucesso." };
});
