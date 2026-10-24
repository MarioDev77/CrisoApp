import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { limitesAntifraude, num, tz } from "@/lib/servicos";

export const GET = api({ auth: ["cliente"] }, async ({ usuario }) => {
  const u = await prisma().usuario.findFirst({ where: { id: usuario.id, tipo: "cliente" } });
  if (!u) throw notFound("Usuario nao encontrado");
  const limites = await limitesAntifraude();
  const pendentes = await prisma().$queryRaw<{ total: string }[]>`SELECT COALESCE(SUM(valor), 0)::text AS total FROM transacoes WHERE id_cliente = ${usuario.id} AND tipo = 'credito'::"TransacaoTipo" AND criado_em > now() - make_interval(hours => ${limites.carencia_horas})`;
  const saldoTotal = num(u.saldo);
  const saldoPendente = Math.min(saldoTotal, Number(pendentes[0]?.total ?? 0));
  const saldoDisponivel = Math.max(0, saldoTotal - saldoPendente);
  return {
    saldo: saldoDisponivel, saldo_total: saldoTotal, saldo_pendente: saldoPendente, total_ganho: num(u.totalGanho), total_utilizado: num(u.totalUtilizado),
    total_reciclado_kg: num(u.totalRecicladoKg), total_trocas: u.totalTrocas,
  };
});
