import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { codigoCurtoDe } from "@/lib/qr-codigo";
import { ROTULO_VOUCHER, statusVoucher } from "@/lib/recompensas";
import { num } from "@/lib/servicos";

const body = z.object({ codigo: z.string({ error: "Informe o código" }).trim().min(4).max(20) });

/** A loja só enxerga vouchers de recompensas VINCULADAS A ELA; qualquer outro código responde igual a "não existe". */
export const POST = api(
  { auth: ["loja"], body, limites: [{ nome: "voucher-consultar", por: "usuario", max: 30, janelaSeg: 300, msg: "Muitas consultas. Aguarde alguns minutos." }] },
  async ({ usuario, body }) => {
    const codigo = codigoCurtoDe(body.codigo);
    const v = codigo ? await prisma().resgateRecompensa.findFirst({ where: { codigo, recompensa: { idLoja: usuario.id } }, include: { cliente: { select: { nome: true } } } }) : null;
    if (!v) throw notFound("Voucher não encontrado para esta loja.");
    const st = statusVoucher(v.status, v.expiraEm);
    return { sucesso: true, voucher: { codigo: v.codigo, recompensa: v.nomeRecompensa, custo: num(v.custo), cliente: v.cliente.nome.split(" ")[0], status: st, status_rotulo: ROTULO_VOUCHER[st], expira_em: v.expiraEm, usado_em: v.usadoEm } };
  },
);
