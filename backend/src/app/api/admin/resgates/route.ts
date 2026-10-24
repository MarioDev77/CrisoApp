import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { num } from "@/lib/servicos";

export const GET = api({ auth: ["admin"] }, async () => {
  const pedidos = await prisma().resgate.findMany({ orderBy: { criadoEm: "desc" }, take: 100, include: { cliente: { select: { id: true, nome: true } } } });
  return { resgates: pedidos.map((r) => ({ id: r.id, id_cliente: r.idCliente, nome_cliente: r.cliente.nome, valor: num(r.valor), forma: r.forma, status: r.status, criado_em: r.criadoEm, atualizado_em: r.atualizadoEm })) };
});
