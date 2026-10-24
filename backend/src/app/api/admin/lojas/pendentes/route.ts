import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { emailDaLoja, responsavelDaLoja } from "@/lib/pii";
import { mascararEmail } from "@/lib/crypto";

export const GET = api({ auth: ["admin"] }, async () => {
  const l = await prisma().loja.findMany({ where: { status: "pendente", deletadoEm: null }, orderBy: { id: "asc" } });
  return { lojas: l.map((x) => ({ id: x.id, nome: x.nome, responsavel: responsavelDaLoja(x), email: mascararEmail(emailDaLoja(x)), criado_em: x.criadoEm })) };
});
