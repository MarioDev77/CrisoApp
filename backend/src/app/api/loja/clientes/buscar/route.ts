import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { num } from "@/lib/servicos";

const query = z.object({ busca: z.string().trim().max(100).default(""), limite: z.coerce.number().int().min(1).max(20).default(8) });

export const GET = api(
  { auth: ["loja"], query, limites: [{ nome: "busca-cliente", por: "usuario", max: 30, janelaSeg: 300, msg: "Muitas buscas. Aguarde alguns minutos." }] },
  async ({ query }) => {
    if (query.busca.length < 2) return { usuarios: [] };
    const rows = await prisma().usuario.findMany({
      where: {
        tipo: "cliente", status: "ativo", deletadoEm: null,
        OR: [{ nome: { contains: query.busca, mode: "insensitive" } }, { email: { contains: query.busca, mode: "insensitive" } }],
      },
      orderBy: { nome: "asc" },
      take: query.limite,
    });
    return { sucesso: true, usuarios: rows.map((u) => ({ id: u.id, nome: u.nome, saldo: num(u.saldo), total_trocas: u.totalTrocas })) };
  },
);
