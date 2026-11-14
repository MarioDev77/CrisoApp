import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { idParam } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";

/** Só atua sobre CLIENTES (admin não bloqueia a si mesmo nem a outro admin). Invalida sessões ao bloquear. */
export const POST = api<unknown, unknown, { id: string }>({ auth: ["admin"] }, async ({ usuario, params, ip }) => {
  const id = idParam.parse(params.id);
  await prisma().$transaction(async (tx) => {
    const antes = await tx.usuario.findFirst({ where: { id, tipo: "cliente", deletadoEm: null }, select: { status: true } });
    if (!antes) throw notFound("Usuario nao encontrado");
    await tx.usuario.update({ where: { id }, data: { status: "bloqueado", versaoSessao: { increment: 1 } } });
    await auditar("admin_bloqueou_usuario", `usuario_id=${id} status: ${antes.status} → bloqueado`, ip, usuario.id, tx);
  });
  return { sucesso: true };
});
