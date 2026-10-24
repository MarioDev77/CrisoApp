import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { idParam } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";
import { camposEmailUsuario, camposTelefoneUsuario } from "@/lib/pii";

export const DELETE = api<unknown, unknown, { id: string }>({ auth: ["admin"] }, async ({ usuario, params, ip }) => {
  const id = idParam.parse(params.id);
  const r = await prisma().$transaction(async (tx) => {
    const alterado = await tx.usuario.updateMany({
      where: { id, tipo: "cliente", deletadoEm: null },
      data: { ...camposEmailUsuario(`excluido-${id}@invalid`), ...camposTelefoneUsuario(""), nome: "Removido", senha: null, foto: null, googleId: null, googleIdHash: null, status: "inativo", deletadoEm: new Date(), deletadoPorId: usuario.id, versaoSessao: { increment: 1 } },
    });
    if (alterado.count) {
      await tx.transacao.updateMany({ where: { idCliente: id }, data: { nomeCliente: null, nomeClienteEnc: null } });
      // Segredo do autenticador e códigos pendentes de uma conta excluída não têm mais finalidade.
      await tx.mfaConta.deleteMany({ where: { contaTipo: "usuario", contaId: id } });
      await tx.passwordResetCode.deleteMany({ where: { usuarioId: id } });
      await tx.emailVerificationCode.deleteMany({ where: { usuarioId: id } });
    }
    return alterado;
  });
  if (r.count === 0) throw notFound("Usuario nao encontrado");
  await auditar("admin_deletou_usuario", `usuario_id=${id}`, ip, usuario.id);
  return { sucesso: true };
});
