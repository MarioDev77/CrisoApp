import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { paginacao } from "@/lib/schemas";
import { num } from "@/lib/servicos";

const query = z.object({
  pagina: paginacao.pagina,
  tipo: z.enum(["credito", "debito", "reciclagem", "resgate"]).optional(),
  dias: z.coerce.number().int().min(1).max(365).optional(),
});
const POR_PAGINA = 20;

export const GET = api({ auth: ["admin"], query }, async ({ query }) => {
  const and: Prisma.TransacaoWhereInput[] = [];
  if (query.tipo) {
    and.push({ OR: [
      ...(query.tipo === "credito" || query.tipo === "debito" ? [{ tipo: query.tipo }] : []),
      ...(query.tipo === "reciclagem" || query.tipo === "resgate" ? [{ categoria: query.tipo }] : []),
    ] });
  }
  if (query.dias) and.push({ criadoEm: { gte: new Date(Date.now() - query.dias * 86_400_000) } });
  const where: Prisma.TransacaoWhereInput = and.length ? { AND: and } : {};
  const [total, lista] = await Promise.all([
    prisma().transacao.count({ where }),
    prisma().transacao.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], skip: (query.pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
  ]);
  return {
    total,
    transacoes: lista.map((t) => ({ id: t.id, criado_em: t.criadoEm, cliente: t.nomeCliente, loja: t.nomeLoja, materiais: t.materiaisDesc, valor: num(t.valor), tipo: t.categoria ?? t.tipo })),
  };
});
