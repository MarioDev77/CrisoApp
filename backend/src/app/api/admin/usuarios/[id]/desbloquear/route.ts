import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { idParam } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";

/** Só atua sobre CLIENTES (admin não bloqueia a si mesmo nem a outro admin). Invalida sessões ao bloquear. */
export const POST = api<unknown, unknown, { id: string }>({ auth: ["admin"] }, async ({ usuario, params, ip }) => {
  const id = idParam.parse(params.id);
  const r = await prisma().usuario.updateMany({
    where: { id, tipo: "cliente", deletadoEm: null },
    data: { status: "ativo", versaoSessao: { increment: 1 } },
  });
  if (r.count === 0) throw notFound("Usuario nao encontrado");
  await auditar("admin_desbloqueou_usuario", `usuario_id=${id}`, ip, usuario.id);
  return { sucesso: true };
});
