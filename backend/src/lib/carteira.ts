import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { notFound } from "./errors";
import { num } from "./servicos";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Saldo do cliente: única fonte é usuarios.saldo (atualizado junto com cada lançamento em transacoes).
 * Créditos de reciclagem dentro do período de carência ficam em "pendente" e não podem ser gastos.
 * Usada por /cliente/carteira e /cliente/dashboard para os dois mostrarem exatamente o mesmo número.
 */
export async function carteiraDoCliente(db: Db, idCliente: number, carenciaHoras: number) {
  const u = await db.usuario.findFirst({ where: { id: idCliente, tipo: "cliente" } });
  if (!u) throw notFound("Usuario nao encontrado");
  const pendentes = await db.$queryRaw<{ total: string }[]>`SELECT COALESCE(SUM(valor), 0)::text AS total FROM transacoes WHERE id_cliente = ${idCliente} AND tipo = 'credito'::"TransacaoTipo" AND categoria = 'reciclagem'::"TransacaoCat" AND criado_em > now() - make_interval(hours => ${carenciaHoras})`;
  const saldoTotal = num(u.saldo);
  const saldoPendente = Math.min(saldoTotal, Number(pendentes[0]?.total ?? 0));
  const saldoDisponivel = Math.max(0, saldoTotal - saldoPendente);
  return {
    saldo: saldoDisponivel, saldo_total: saldoTotal, saldo_pendente: saldoPendente, total_ganho: num(u.totalGanho), total_utilizado: num(u.totalUtilizado),
    total_reciclado_kg: num(u.totalRecicladoKg), total_trocas: u.totalTrocas,
  };
}
