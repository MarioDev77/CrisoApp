import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { ROTULO_VOUCHER, statusVoucher } from "@/lib/recompensas";
import { paginacao } from "@/lib/schemas";
import { num } from "@/lib/servicos";

const query = z.object({ pagina: paginacao.pagina, status: z.enum(["ativo", "utilizado", "cancelado", "expirado"]).optional() });
const POR_PAGINA = 20;

export const GET = api({ auth: ["admin"], query }, async ({ query }) => {
  const agora = new Date();
  // "expirado" é calculado: ativo + vencido, ou já gravado como expirado.
  const filtro: Prisma.ResgateRecompensaWhereInput =
    query.status === "ativo" ? { status: "ativo", expiraEm: { gte: agora } }
    : query.status === "expirado" ? { OR: [{ status: "expirado" }, { status: "ativo", expiraEm: { lt: agora } }] }
    : query.status ? { status: query.status } : {};
  const [total, lista] = await Promise.all([
    prisma().resgateRecompensa.count({ where: filtro }),
    prisma().resgateRecompensa.findMany({
      where: filtro, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], skip: (query.pagina - 1) * POR_PAGINA, take: POR_PAGINA,
      include: { cliente: { select: { nome: true } }, recompensa: { select: { loja: { select: { nome: true } } } } },
    }),
  ]);
  return {
    sucesso: true, total,
    resgates: lista.map((v) => {
      const st = statusVoucher(v.status, v.expiraEm, agora);
      return { id: v.id, criado_em: v.criadoEm, cliente: v.cliente.nome, recompensa: v.nomeRecompensa, estabelecimento: v.recompensa.loja?.nome ?? null, custo: num(v.custo), codigo: v.codigo, status: st, status_rotulo: ROTULO_VOUCHER[st], expira_em: v.expiraEm };
    }),
  };
});
