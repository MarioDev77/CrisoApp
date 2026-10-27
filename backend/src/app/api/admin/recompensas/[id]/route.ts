import type { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { recompensaAtualizar } from "@/lib/recompensas";
import { idParam } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";

/**
 * Edita o catálogo. Vouchers já emitidos guardam uma cópia do nome e do custo, então mudar o preço não altera o que já foi cobrado.
 * Não existe exclusão: recompensas com resgates têm vínculo no histórico. Para retirar do catálogo, desative.
 */
export const PATCH = api<z.infer<typeof recompensaAtualizar>, unknown, { id: string }>({ auth: ["admin"], body: recompensaAtualizar }, async ({ usuario, body, params, ip }) => {
  const id = idParam.parse(params.id);
  if (body.idLoja && !(await prisma().loja.findFirst({ where: { id: body.idLoja, status: "ativo", deletadoEm: null } }))) throw new HttpError(400, "Estabelecimento inválido.");
  const r = await prisma().recompensa.updateMany({ where: { id }, data: body });
  if (!r.count) throw notFound("Recompensa não encontrada.");
  await auditar("admin_editou_recompensa", `recompensa=${id} campos=${Object.keys(body).join(",")}`, ip, usuario.id);
  return { sucesso: true };
});
