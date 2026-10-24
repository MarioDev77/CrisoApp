import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { num } from "@/lib/servicos";

const body = z.object({ token: z.string({ error: "Token ausente" }).trim().min(1, "Token ausente").max(255) });

export const POST = api(
  { auth: ["cliente"], body, limites: [{ nome: "qr-validar", por: "usuario", max: 5, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." }] },
  async ({ body }) => {
    const qr = await prisma().qrCode.findUnique({ where: { token: body.token } });
    if (!qr) throw new HttpError(404, "QR Code nao encontrado", { valido: false });
    if (qr.status !== "ativo") throw new HttpError(400, "QR Code ja utilizado ou expirado", { valido: false });
    if (qr.expiraEm < new Date()) {
      await prisma().qrCode.updateMany({ where: { token: qr.token, status: "ativo" }, data: { status: "expirado" } });
      throw new HttpError(400, "QR Code expirado", { valido: false });
    }
    return {
      valido: true, id_transacao: qr.idTransacao, tipo: qr.tipo, valor: num(qr.valor), id_loja: qr.idLoja,
      nome_loja: qr.nomeLoja, descricao_material: qr.materiaisDesc, produto: qr.produto, expira_em: qr.expiraEm,
    };
  },
);
