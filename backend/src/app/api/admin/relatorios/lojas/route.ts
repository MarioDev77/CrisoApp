import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { mesYYYYMM } from "@/lib/schemas";
import { arred, num, tz } from "@/lib/servicos";

const query = z.object({ mes: mesYYYYMM.optional() });

export const GET = api({ auth: ["admin"], query }, async ({ query }) => {
  const z_ = tz();
  const [ano, mesNum] = query.mes ? query.mes.split("-").map(Number) : [0, 0];
  // intervalo [ini, fim) do mês no fuso da aplicação (usa índice em criado_em)
  const rng = await prisma().$queryRaw<{ ini: Date; fim: Date; periodo: string }[]>`
    SELECT i AS ini, (i + interval '1 month') AS fim, to_char(i AT TIME ZONE ${z_}, 'YYYY-MM') AS periodo
    FROM (SELECT CASE WHEN ${ano}::int > 0
                      THEN make_timestamptz(${ano}::int, ${mesNum}::int, 1, 0, 0, 0, ${z_})
                      ELSE date_trunc('month', now() AT TIME ZONE ${z_}) AT TIME ZONE ${z_} END AS i) s`;
  const { ini, fim, periodo } = rng[0];
  const [lojas, cred, deb, prod] = await Promise.all([
    prisma().loja.findMany({ where: { deletadoEm: null }, orderBy: { id: "asc" } }),
    prisma().transacao.groupBy({ by: ["idLoja"], where: { tipo: "credito", criadoEm: { gte: ini, lt: fim } }, _count: { _all: true }, _sum: { kg: true, valor: true } }),
    prisma().transacao.groupBy({ by: ["idLoja"], where: { tipo: "debito", criadoEm: { gte: ini, lt: fim } }, _count: { _all: true }, _sum: { valor: true } }),
    prisma().$queryRaw<{ id_loja: number; produto: string; quantidade: number; total: string }[]>`
      SELECT id_loja, COALESCE(NULLIF(materiais_desc,''),'-') AS produto, count(*)::int AS quantidade, COALESCE(sum(valor),0)::text AS total
      FROM transacoes WHERE tipo='debito' AND criado_em >= ${ini} AND criado_em < ${fim} AND id_loja IS NOT NULL
      GROUP BY id_loja, 2`,
  ]);
  const c = new Map(cred.map((x) => [x.idLoja, x]));
  const d = new Map(deb.map((x) => [x.idLoja, x]));
  return {
    periodo: query.mes ?? periodo,
    lojas: lojas.map((l) => {
      const kg = num(c.get(l.id)?._sum.kg);
      return {
        id: l.id, nome: l.nome, responsavel: l.responsavel, status: l.status,
        total_trocas: c.get(l.id)?._count._all ?? 0, total_kg: arred(kg), total_creditos: arred(num(c.get(l.id)?._sum.valor)),
        total_resgates: d.get(l.id)?._count._all ?? 0, total_debitos: arred(num(d.get(l.id)?._sum.valor)),
        co2_evitado: arred(kg * 0.5),
        produtos: prod.filter((p) => p.id_loja === l.id).map((p) => ({ produto: p.produto, quantidade: p.quantidade, total: arred(num(p.total)) })),
      };
    }),
  };
});
