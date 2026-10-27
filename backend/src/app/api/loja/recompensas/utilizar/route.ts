import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { codigoCurtoDe } from "@/lib/qr-codigo";
import { auditar } from "@/lib/servicos";

const body = z.object({ codigo: z.string({ error: "Informe o código" }).trim().min(4).max(20) });

/** Dá baixa no voucher (uso único). A linha é travada: duas lojas/abas tentando o mesmo código ao mesmo tempo → só uma conclui. */
export const POST = api(
  { auth: ["loja"], body, limites: [{ nome: "voucher-utilizar", por: "usuario", max: 30, janelaSeg: 300, msg: "Muitas tentativas. Aguarde alguns minutos." }] },
  async ({ usuario, body, ip }) => {
    const codigo = codigoCurtoDe(body.codigo);
    if (!codigo) throw notFound("Voucher não encontrado para esta loja.");
    const id = await prisma().$transaction(async (tx) => {
      const linhas = await tx.$queryRaw<{ id: number; status: string; expira_em: Date }[]>`
        SELECT v.id, v.status::text AS status, v.expira_em FROM resgates_recompensa v JOIN recompensas r ON r.id = v.id_recompensa
        WHERE v.codigo = ${codigo} AND r.id_loja = ${usuario.id} FOR UPDATE OF v`;
      const v = linhas[0];
      if (!v) throw notFound("Voucher não encontrado para esta loja.");
      if (v.status !== "ativo") throw new HttpError(409, "Este voucher não pode mais ser utilizado.");
      if (v.expira_em < new Date()) throw new HttpError(409, "Este voucher venceu.");
      await tx.resgateRecompensa.update({ where: { id: v.id }, data: { status: "utilizado", usadoEm: new Date() } });
      await auditar("loja_baixou_voucher", `voucher=${v.id} loja=${usuario.id}`, ip, null, tx);
      return v.id;
    });
    return { sucesso: true, id, status: "utilizado" };
  },
);
