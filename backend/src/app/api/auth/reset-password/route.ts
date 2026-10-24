import { z } from "zod";
import { api } from "@/lib/api";
import { hashSenha, lerResetToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { senhaNova } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";

const body = z.object({ resetToken: z.string({ error: "Dados incompletos." }).min(10).max(2000), novaSenha: senhaNova });

export const POST = api(
  { auth: false, body, limites: [{ nome: "reset-senha-ip", por: "ip", max: 30, janelaSeg: 900 }] },
  async ({ body, ip }) => {
    const t = await lerResetToken(body.resetToken);
    if (!t) throw new HttpError(400, "Sessão de redefinição expirada. Solicite um novo código.");
    const codigoId = t.v; // no token, "v" carrega o id do código
    const hash = await hashSenha(body.novaSenha);
    const r = await prisma().$transaction(async (tx) => {
      // consome o código de forma atômica: só um reset por código
      const consumiu = await tx.passwordResetCode.updateMany({
        where: { id: codigoId, usuarioId: t.id, utilizado: false, expiraEm: { gt: new Date() } },
        data: { utilizado: true },
      });
      if (consumiu.count === 0) return false;
      // novo hash + invalida todas as sessões existentes
      await tx.usuario.update({ where: { id: t.id }, data: { senha: hash, versaoSessao: { increment: 1 } } });
      return true;
    });
    if (!r) throw new HttpError(400, "Código já utilizado, expirado ou inválido.");
    await auditar("senha_redefinida", "via=codigo_email sessoes_encerradas=true", ip, t.id);
    return { sucesso: true, mensagem: "Senha redefinida com sucesso." };
  },
);
