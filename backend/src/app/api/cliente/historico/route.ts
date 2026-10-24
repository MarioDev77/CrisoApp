import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { num } from "@/lib/servicos";

const query = z.object({ tipo: z.enum(["credito", "debito"]).optional(), limite: z.coerce.number().int().min(1).max(500).default(200) });

export const GET = api({ auth: ["cliente"], query }, async ({ usuario, query }) => {
  const lista = await prisma().transacao.findMany({
    where: { idCliente: usuario.id, ...(query.tipo ? { tipo: query.tipo } : {}) },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    take: query.limite,
  });
  return lista.map((t) => ({
    id: t.id, tipo: t.tipo, valor: num(t.valor), categoria: t.categoria,
    loja: t.nomeLoja, materiais: t.materiaisDesc, criado_em: t.criadoEm,
  }));
});
