import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { idParam } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";

export const POST = api<unknown, unknown, { id: string }>({ auth: ["admin"] }, async ({ usuario, params, ip }) => {
  const id = idParam.parse(params.id);
  const r = await prisma().loja.updateMany({ where: { id, deletadoEm: null }, data: { status: "ativo" } });
  if (r.count === 0) throw notFound("Loja nao encontrada");
  await auditar("admin_aprovou_loja", `loja_id=${id}`, ip, usuario.id);
  return { sucesso: true };
});
