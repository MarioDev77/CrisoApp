import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { paginacao } from "@/lib/schemas";
import { num } from "@/lib/servicos";

const query = z.object({ pagina: paginacao.pagina, status: z.enum(["ativo", "bloqueado", "inativo"]).optional() });
const POR_PAGINA = 20;

export const GET = api({ auth: ["admin"], query }, async ({ query }) => {
  const where = { tipo: "cliente" as const, deletadoEm: null, ...(query.status ? { status: query.status } : {}) };
  const [total, lista] = await Promise.all([
    prisma().usuario.count({ where }),
    prisma().usuario.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], skip: (query.pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
  ]);
  return { total, usuarios: lista.map((u) => ({ id: u.id, nome: u.nome, email: u.email, saldo: num(u.saldo), total_trocas: u.totalTrocas, status: u.status })) };
});
