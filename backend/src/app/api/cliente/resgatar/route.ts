import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { arred, auditar, limitesAntifraude, num, tz } from "@/lib/servicos";
import { sessaoAutenticadaRecentemente } from "@/lib/auth";
import { emailDoUsuario } from "@/lib/pii";
import { enviarAvisoResgate } from "@/lib/email";
import { log } from "@/lib/log";
import { MSG_PERFIL_INCOMPLETO, perfilCompleto } from "@/lib/perfil";

const body = z.object({
  valor: z.coerce.number({ error: "Valor inválido" }).positive("Valor inválido").max(100, "O limite diário por solicitação é R$ 100,00."),
  forma: z.enum(["pix"]).default("pix"),
});

export const POST = api(
  { auth: ["cliente"], body, limites: [{ nome: "resgate", por: "usuario", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." }] },
  async ({ usuario, body, ip }) => {
    if (!sessaoAutenticadaRecentemente(usuario)) throw new HttpError(401, "Entre novamente para confirmar sua identidade antes do resgate.");
    const valor = arred(body.valor);
    if (valor <= 0) throw new HttpError(400, "Valor inválido");
    const limites = await limitesAntifraude();
    const resultado = await prisma().$transaction(async (tx) => {
      const contas = await tx.$queryRaw<{ id: number; saldo: string; nome: string; email: string }[]>`
        SELECT id, saldo::text AS saldo, nome, email FROM usuarios
        WHERE id = ${usuario.id} AND tipo = 'cliente' AND status = 'ativo' AND deletado_em IS NULL FOR UPDATE`;
      const conta = contas[0];
      if (!conta) throw new HttpError(404, "Conta não encontrada.");
      const cli = await tx.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
      if (!perfilCompleto(cli)) throw new HttpError(403, MSG_PERFIL_INCOMPLETO, { perfil_incompleto: true });
      const usos = await tx.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(valor), 0)::text AS total FROM resgates
        WHERE id_cliente = ${usuario.id} AND (criado_em AT TIME ZONE ${tz()})::date = (now() AT TIME ZONE ${tz()})::date`;
      const usadoHoje = Number(usos[0].total);
      if (usadoHoje + valor > limites.resgate_cliente_dia) throw new HttpError(429, "Limite diário de resgates atingido.");
      const pendentes = await tx.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(valor), 0)::text AS total FROM transacoes
        WHERE id_cliente = ${usuario.id} AND tipo = 'credito'::"TransacaoTipo"
          AND categoria = 'reciclagem'::"TransacaoCat"
          AND criado_em > now() - make_interval(hours => ${limites.carencia_horas})`;
      const saldo = Number(conta.saldo);
      const disponivel = Math.max(0, saldo - Number(pendentes[0].total));
      if (disponivel < valor) throw new HttpError(400, "Saldo disponível insuficiente; créditos recentes podem estar em carência.");
      const debitado = await tx.$queryRaw<{ saldo: string }[]>`
        UPDATE usuarios SET saldo = saldo - ${valor}::numeric, total_utilizado = total_utilizado + ${valor}::numeric
        WHERE id = ${usuario.id} AND saldo >= ${valor}::numeric RETURNING saldo::text AS saldo`;
      if (!debitado.length) throw new HttpError(400, "Saldo insuficiente.");
      const transacao = await tx.transacao.create({
        data: { idCliente: usuario.id, nomeCliente: conta.nome, idLoja: null, nomeLoja: "CrisoVerde", tipo: "debito", categoria: "resgate", valor, forma: body.forma, kg: 0, materiaisDesc: "Resgate pendente de aprovação" },
      });
      const pedido = await tx.resgate.create({ data: { idCliente: usuario.id, idTransacao: transacao.id, valor, forma: body.forma } });
      return { id: pedido.id, saldo: Number(debitado[0].saldo), email: conta.email, nome: conta.nome };
    });
    try { await enviarAvisoResgate(emailDoUsuario({ email: resultado.email, telefone: "" }), resultado.nome, valor, "pendente"); }
    catch (e) { log.error("falha_envio_aviso_resgate", { erro: e instanceof Error ? e.message : "erro desconhecido" }); }
    await auditar("resgate_solicitado", `pedido=${resultado.id} status=pendente`, ip, usuario.id);
    return { sucesso: true, mensagem: "Resgate solicitado e aguardando aprovação.", status: "pendente", id_resgate: resultado.id, novo_saldo: resultado.saldo };
  },
);
