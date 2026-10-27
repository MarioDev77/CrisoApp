import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { anotarMovimentacoes } from "@/lib/extrato";
import { limitesAntifraude } from "@/lib/servicos";

const query = z.object({ tipo: z.enum(["credito", "debito"]).optional(), limite: z.coerce.number().int().min(1).max(500).default(200) });

export const GET = api({ auth: ["cliente"], query }, async ({ usuario, query }) => {
  const [lista, limites] = await Promise.all([
    prisma().transacao.findMany({
      where: { idCliente: usuario.id, ...(query.tipo ? { tipo: query.tipo } : {}) },
      orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
      take: query.limite,
    }),
    limitesAntifraude(),
  ]);
  // Campos originais (id, tipo, valor, categoria, loja, materiais, criado_em) continuam iguais; os demais são acréscimos.
  return anotarMovimentacoes(prisma(), lista, limites.carencia_horas);
});
