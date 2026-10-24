import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { filtroBuscaCliente, resumoClienteBusca } from "@/lib/client-search";

const query = z.object({ busca: z.string().trim().max(100).default(""), limite: z.coerce.number().int().min(1).max(20).default(8) });

export const GET = api(
  { auth: ["loja"], query, limites: [{ nome: "busca-cliente", por: "usuario", max: 15, janelaSeg: 900, msg: "Muitas buscas. Aguarde 15 minutos." }] },
  async ({ query }) => {
    const whereBusca = filtroBuscaCliente(query.busca);
    if (!whereBusca) return { usuarios: [] };
    const rows = await prisma().usuario.findMany({
      where: {
        tipo: "cliente", status: "ativo", deletadoEm: null,
        ...whereBusca,
      },
      orderBy: { nome: "asc" },
      take: Math.min(query.limite, 5),
    });
    return { sucesso: true, usuarios: rows.map(resumoClienteBusca) };
  },
);
