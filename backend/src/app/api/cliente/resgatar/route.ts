import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { arred } from "@/lib/servicos";

const body = z.object({
  valor: z.coerce.number({ error: "Valor invalido" }).positive("Valor invalido").max(1_000_000, "Valor invalido"),
  forma: z.string().trim().min(1).max(50).default("pix"),
});

export const POST = api(
  { auth: ["cliente"], body, limites: [{ nome: "resgate", por: "usuario", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." }] },
  async ({ usuario, body }) => {
    const v = arred(body.valor);
    if (v <= 0) throw new HttpError(400, "Valor invalido");
    return prisma().$transaction(async (tx) => {
      // Débito atômico: a condição saldo >= valor + o CHECK do banco impedem saldo negativo
      // mesmo com requisições simultâneas.
      const r = await tx.$queryRaw<{ saldo: string; nome: string }[]>`
        UPDATE usuarios SET saldo = saldo - ${v}::numeric, total_utilizado = total_utilizado + ${v}::numeric
        WHERE id = ${usuario.id} AND tipo = 'cliente' AND saldo >= ${v}::numeric
        RETURNING saldo::text AS saldo, nome`;
      if (r.length === 0) throw new HttpError(400, "Saldo insuficiente");
      await tx.transacao.create({
        data: { idCliente: usuario.id, nomeCliente: r[0].nome, idLoja: null, nomeLoja: "CrisoVerde", tipo: "debito", categoria: "resgate", valor: v, forma: body.forma, kg: 0, materiaisDesc: "-" },
      });
      return { sucesso: true, mensagem: "Resgate solicitado com sucesso!", novo_saldo: Number(r[0].saldo) };
    });
  },
);
