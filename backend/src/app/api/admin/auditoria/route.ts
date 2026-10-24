import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { paginacao } from "@/lib/schemas";

const query = z.object({ pagina: paginacao.pagina, acao: z.string().trim().max(100).optional() });
const POR_PAGINA = 20;

export const GET = api({ auth: ["admin"], query }, async ({ query }) => {
  const where = query.acao ? { acao: query.acao } : {};
  const [total, logs] = await Promise.all([
    prisma().logAuditoria.count({ where }),
    prisma().logAuditoria.findMany({ where, include: { cliente: { select: { nome: true, email: true } } }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], skip: (query.pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
  ]);
  return {
    total,
    logs: logs.map((l) => ({ id: l.id, acao: l.acao, detalhe: l.detalhe, ip: l.ip, criado_em: l.criadoEm, nome_cliente: l.cliente?.nome ?? null, email_cliente: l.cliente?.email ?? null, id_cliente: l.idCliente })),
  };
});
