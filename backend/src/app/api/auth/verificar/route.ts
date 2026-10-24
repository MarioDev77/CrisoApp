import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { perfilCompleto } from "@/lib/perfil";

export const GET = api({ auth: ["cliente", "loja", "admin"] }, async ({ usuario }) => {
  if (usuario.tipo !== "cliente") return { sucesso: true, usuario };
  const u = await prisma().usuario.findUnique({ where: { id: usuario.id } });
  return { sucesso: true, usuario: { ...usuario, perfil_completo: u ? perfilCompleto(u) : false } };
});
