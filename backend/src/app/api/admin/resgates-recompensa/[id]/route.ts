import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { idParam } from "@/lib/schemas";
import { auditar } from "@/lib/servicos";

const body = z.object({ acao: z.enum(["utilizar", "cancelar"]) });

/**
 * utilizar = baixa manual do voucher.
 * cancelar = devolve as Crisomoedas (estorno no mesmo livro-razão) e devolve a unidade ao estoque. Só voucher ATIVO e dentro da validade.
 */
export const PATCH = api<z.infer<typeof body>, unknown, { id: string }>({ auth: ["admin"], body }, async ({ usuario, body, params, ip }) => {
  const id = idParam.parse(params.id);
  const status = await prisma().$transaction(async (tx) => {
    const linhas = await tx.$queryRaw<{ id: number; id_cliente: number; id_recompensa: number; custo: string; status: string; expira_em: Date; nome: string }[]>`
      SELECT id, id_cliente, id_recompensa, custo::text AS custo, status::text AS status, expira_em, nome_recompensa AS nome FROM resgates_recompensa WHERE id = ${id} FOR UPDATE`;
    const v = linhas[0];
    if (!v) throw notFound("Resgate não encontrado.");
    if (v.status !== "ativo") throw new HttpError(409, "Este voucher não está mais ativo.");
    if (v.expira_em < new Date()) throw new HttpError(409, "Este voucher já venceu.");
    if (body.acao === "utilizar") {
      await tx.resgateRecompensa.update({ where: { id }, data: { status: "utilizado", usadoEm: new Date() } });
      return "utilizado";
    }
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${v.id_cliente} FOR UPDATE`;
    const cli = await tx.usuario.findUniqueOrThrow({ where: { id: v.id_cliente } });
    await tx.resgateRecompensa.update({ where: { id }, data: { status: "cancelado", canceladoEm: new Date() } });
    await tx.usuario.update({ where: { id: v.id_cliente }, data: { saldo: { increment: v.custo }, totalUtilizado: { decrement: v.custo } } });
    await tx.$executeRaw`UPDATE recompensas SET estoque = estoque + 1 WHERE id = ${v.id_recompensa} AND estoque IS NOT NULL`;
    await tx.transacao.create({ data: { idCliente: v.id_cliente, nomeCliente: cli.nome, nomeLoja: "CrisoVerde", tipo: "credito", categoria: "resgate", valor: v.custo, forma: "estorno_recompensa", kg: 0, materiaisDesc: `Estorno de recompensa #${id}`.slice(0, 500) } });
    await auditar("admin_cancelou_voucher", `voucher=${id} estorno=${v.custo}`, ip, usuario.id, tx);
    return "cancelado";
  });
  if (status === "utilizado") await auditar("admin_baixou_voucher", `voucher=${id}`, ip, usuario.id);
  return { sucesso: true, id, status };
});
