import crypto from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { hashCodigo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { enviarCodigoRecuperacao } from "@/lib/email";
import { log } from "@/lib/log";
import { email } from "@/lib/schemas";
import { contar } from "@/lib/rate-limit";
import { buscarUsuarioPorEmail, emailDoUsuario } from "@/lib/pii";

const MSG = { sucesso: true, mensagem: "Se este e-mail estiver cadastrado, você receberá um código de verificação em instantes." };
const body = z.object({ email: email.catch("" as string) }).refine((b) => b.email !== "", { message: "Informe um e-mail válido.", path: ["email"] });

export const POST = api(
  { auth: false, body, limites: [
    { nome: "forgot-ip", por: "ip", max: 20, janelaSeg: 900 },
    { nome: "forgot", por: "ip+email", max: 3, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." },
  ] },
  async ({ body }) => {
    const encontrado = await buscarUsuarioPorEmail(prisma(), body.email);
    const u = encontrado?.status === "ativo" && !encontrado.deletadoEm ? encontrado : null;
    if (!u || u.tipo === "admin") return MSG;
    // Teto de e-mails ENVIADOS por conta (evita bombardear a caixa da vítima). Excedeu: mesma resposta, nada é enviado,
    // sem 429 (não revela nada e não vira sinal de que a conta existe). Só conta quando a conta existe, ou seja, e-mails de fato enviáveis.
    if ((await contar({ nome: "forgot-email", janelaSeg: 3600 }, body.email)).contagem > 5) return MSG;
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma().$transaction([
      prisma().passwordResetCode.updateMany({ where: { usuarioId: u.id, utilizado: false }, data: { utilizado: true } }),
      prisma().passwordResetCode.create({ data: { usuarioId: u.id, codigoHash: hashCodigo(codigo), expiraEm: new Date(Date.now() + 10 * 60_000) } }),
    ]);
    try {
      await enviarCodigoRecuperacao(emailDoUsuario(u), u.nome, codigo);
    } catch (e) {
      log.error("falha_envio_email_recuperacao", { erro: e instanceof Error ? e.message : String(e) });
    }
    return MSG;
  },
);
