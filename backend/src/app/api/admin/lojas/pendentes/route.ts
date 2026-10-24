import { api } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = api({ auth: ["admin"] }, async () => {
  const l = await prisma().loja.findMany({ where: { status: "pendente", deletadoEm: null }, orderBy: { id: "asc" } });
  return { lojas: l.map((x) => ({ id: x.id, nome: x.nome, responsavel: x.responsavel, email: x.email, criado_em: x.criadoEm })) };
});
