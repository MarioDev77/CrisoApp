import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { num } from "@/lib/servicos";

const query = z.object({
  dias: z.coerce.number().int().min(1).max(3650).optional(),
  limite: z.coerce.number().int().min(1).max(1000).default(500),
});

export const GET = api({ auth: ["loja"], query }, async ({ usuario, query }) => {
  const desde = query.dias ? new Date(Date.now() - query.dias * 86_400_000) : undefined;
  const t = await prisma().transacao.findMany({
    where: { idLoja: usuario.id, tipo: "credito", ...(desde ? { criadoEm: { gte: desde } } : {}) },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    take: query.limite,
  });
  return { trocas: t.map((x) => ({ id: x.id, cliente: x.nomeCliente, materiais: x.materiaisDesc, valor_total: num(x.valor), data: x.criadoEm })) };
});
