import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { auditar, num } from "@/lib/servicos";
import { emailDoUsuario } from "@/lib/pii";
import { enviarAvisoResgate } from "@/lib/email";
import { log } from "@/lib/log";

const body = z.object({ status: z.enum(["aprovado", "pago", "cancelado"]) });
export const PATCH = api({ auth: ["admin"], body }, async ({ usuario, body, params, ip }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound("Resgate não encontrado");
  const resultado = await prisma().$transaction(async (tx) => {
    const pedido = await tx.resgate.findUnique({ where: { id }, include: { cliente: true } });
    if (!pedido) throw notFound("Resgate não encontrado");
    const anterior = pedido.status;
    if (anterior === "pendente" && body.status === "cancelado") {
      const alterado = await tx.resgate.updateMany({ where: { id, status: "pendente" }, data: { status: "cancelado" } });
      if (!alterado.count) throw new HttpError(409, "O pedido já foi atualizado.");
      await tx.usuario.update({ where: { id: pedido.idCliente }, data: { saldo: { increment: pedido.valor }, totalUtilizado: { decrement: pedido.valor } } });
      await tx.transacao.create({ data: { idCliente: pedido.idCliente, nomeCliente: pedido.cliente.nome, nomeLoja: "CrisoVerde", tipo: "credito", categoria: "resgate", valor: pedido.valor, forma: "estorno_resgate", kg: 0, materiaisDesc: `Estorno de resgate #${pedido.id}` } });
    } else if (anterior === "pendente" && body.status === "aprovado") {
      const alterado = await tx.resgate.updateMany({ where: { id, status: "pendente" }, data: { status: "aprovado" } });
      if (!alterado.count) throw new HttpError(409, "O pedido já foi atualizado.");
    } else if (anterior === "aprovado" && body.status === "pago") {
      const alterado = await tx.resgate.updateMany({ where: { id, status: "aprovado" }, data: { status: "pago" } });
      if (!alterado.count) throw new HttpError(409, "O pedido já foi atualizado.");
    } else {
      throw new HttpError(409, "Transição de status não permitida.");
    }
    return { status: body.status, email: emailDoUsuario(pedido.cliente), nome: pedido.cliente.nome, valor: num(pedido.valor) };
  });
  await auditar("admin_atualizou_resgate", `resgate=${id} status=${resultado.status}`, ip, usuario.id);
  try { await enviarAvisoResgate(resultado.email, resultado.nome, resultado.valor, resultado.status); }
  catch (e) { log.error("falha_envio_aviso_resgate", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
  return { sucesso: true, id_resgate: id, status: resultado.status };
});
