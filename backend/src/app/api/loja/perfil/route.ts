import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";

export const GET = api({ auth: ["loja"] }, async ({ usuario }) => {
  const l = await prisma().loja.findUnique({ where: { id: usuario.id } });
  if (!l) throw notFound("Loja nao encontrada");
  return { id: l.id, nome: l.nome, responsavel: l.responsavel, email: l.email, telefone: l.telefone, endereco: l.endereco, status: l.status, criado_em: l.criadoEm };
});
