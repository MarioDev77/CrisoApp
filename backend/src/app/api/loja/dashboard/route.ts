import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { num } from "@/lib/servicos";

export const GET = api({ auth: ["loja"] }, async ({ usuario }) => {
  const where = { idLoja: usuario.id, tipo: "credito" as const };
  const [agg, ultimas] = await Promise.all([
    prisma().transacao.aggregate({ where, _count: { _all: true }, _sum: { kg: true, valor: true } }),
    prisma().transacao.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 5 }),
  ]);
  const kg = num(agg._sum.kg);
  return {
    total_trocas: agg._count._all,
    total_kg: kg,
    total_creditos: num(agg._sum.valor),
    co2_evitado: kg * 0.5,
    ultimas_trocas: ultimas.map((t) => ({ cliente: t.nomeCliente, materiais: t.materiaisDesc, valor_total: num(t.valor), data: t.criadoEm })),
  };
});
