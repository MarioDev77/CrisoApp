import crypto from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { emitirResetToken, hashCodigo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { email } from "@/lib/schemas";
import { buscarUsuarioPorEmail } from "@/lib/pii";

const MAX_TENTATIVAS = 5;
const body = z.object({ email, codigo: z.string({ error: "Informe o e-mail e o código recebido." }).trim().regex(/^\d{6}$/, "Código incorreto.") });
const iguais = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const POST = api(
  { auth: false, body, limites: [
    { nome: "reset-ip", por: "ip", max: 60, janelaSeg: 900 },
    { nome: "reset-codigo", por: "ip+email", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
    { nome: "reset-email", por: "email", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
  ] },
  async ({ body }) => {
    const encontrado = await buscarUsuarioPorEmail(prisma(), body.email);
    const u = encontrado && !encontrado.deletadoEm && encontrado.tipo !== "admin" ? encontrado : null;
    if (!u) throw new HttpError(400, "Código inválido ou expirado.");
    const reg = await prisma().passwordResetCode.findFirst({ where: { usuarioId: u.id, utilizado: false }, orderBy: { criadoEm: "desc" } });
    if (!reg) throw new HttpError(400, "Código inválido ou expirado.");
    if (reg.expiraEm < new Date()) throw new HttpError(400, "Código expirado. Solicite um novo.");
    // Contagem ATÔMICA: reserva a tentativa antes de comparar (impede rajadas paralelas além do limite).
    const reservou = await prisma().passwordResetCode.updateMany({
      where: { id: reg.id, utilizado: false, tentativas: { lt: MAX_TENTATIVAS } },
      data: { tentativas: { increment: 1 } },
    });
    if (reservou.count === 0) throw new HttpError(429, "Número máximo de tentativas excedido. Solicite um novo código.");
    if (!iguais(hashCodigo(body.codigo), reg.codigoHash)) throw new HttpError(400, "Código incorreto.");
    const resetToken = await emitirResetToken(u.id, reg.id);
    return { sucesso: true, mensagem: "Código verificado com sucesso.", resetToken };
  },
);
