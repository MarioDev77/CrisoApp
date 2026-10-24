import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { num } from "@/lib/servicos";

export const GET = api({ auth: ["cliente"] }, async ({ usuario }) => {
  const u = await prisma().usuario.findFirst({ where: { id: usuario.id, tipo: "cliente" } });
  if (!u) throw notFound("Usuario nao encontrado");
  return {
    saldo: num(u.saldo), total_ganho: num(u.totalGanho), total_utilizado: num(u.totalUtilizado),
    total_reciclado_kg: num(u.totalRecicladoKg), total_trocas: u.totalTrocas,
  };
});
