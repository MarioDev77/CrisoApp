import crypto from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { hashCodigo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enviarCodigoRecuperacao } from "@/lib/email";
import { log } from "@/lib/log";
import { email } from "@/lib/schemas";

const MSG = { sucesso: true, mensagem: "Se este e-mail estiver cadastrado, você receberá um código de verificação em instantes." };
const body = z.object({ email: email.catch("" as string) }).refine((b) => b.email !== "", { message: "Informe um e-mail válido.", path: ["email"] });

export const POST = api(
  { auth: false, body, limites: [
    { nome: "forgot-ip", por: "ip", max: 20, janelaSeg: 900 },
    { nome: "forgot", por: "ip+email", max: 3, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
  ] },
  async ({ body }) => {
    const u = await prisma().usuario.findFirst({ where: { email: body.email, status: "ativo", deletadoEm: null } });
    if (!u) return MSG;
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma().$transaction([
      prisma().passwordResetCode.updateMany({ where: { usuarioId: u.id, utilizado: false }, data: { utilizado: true } }),
      prisma().passwordResetCode.create({ data: { usuarioId: u.id, codigoHash: hashCodigo(codigo), expiraEm: new Date(Date.now() + 10 * 60_000) } }),
    ]);
    try {
      await enviarCodigoRecuperacao(u.email, u.nome, codigo);
    } catch (e) {
      log.error("falha_envio_email_recuperacao", { erro: e instanceof Error ? e.message : String(e) });
    }
    return MSG;
  },
);
