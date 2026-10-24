import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { emailDaLoja, enderecoDaLoja, responsavelDaLoja, telefoneDaLoja } from "@/lib/pii";

export const GET = api({ auth: ["loja"] }, async ({ usuario }) => {
  const l = await prisma().loja.findUnique({ where: { id: usuario.id } });
  if (!l) throw notFound("Loja nao encontrada");
  return { id: l.id, nome: l.nome, responsavel: responsavelDaLoja(l), email: emailDaLoja(l), telefone: telefoneDaLoja(l), endereco: enderecoDaLoja(l), status: l.status, criado_em: l.criadoEm };
});
