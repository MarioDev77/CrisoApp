import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { idParam } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";
import { camposEmailLoja, camposEnderecoLoja, camposResponsavelLoja, camposTelefoneLoja } from "@/lib/pii";

export const DELETE = api<unknown, unknown, { id: string }>({ auth: ["admin"] }, async ({ usuario, params, ip }) => {
  const id = idParam.parse(params.id);
  const r = await prisma().loja.updateMany({
    where: { id, deletadoEm: null },
    data: { ...camposEmailLoja(`excluido-${id}@invalid`), ...camposTelefoneLoja(""), ...camposEnderecoLoja(null), ...camposResponsavelLoja("Removido"), nome: "Removido", status: "inativo", deletadoEm: new Date(), deletadoPorId: usuario.id, versaoSessao: { increment: 1 } },
  });
  if (r.count === 0) throw notFound("Loja nao encontrada");
  await auditar("admin_deletou_loja", `loja_id=${id}`, ip, usuario.id);
  return { sucesso: true };
});
