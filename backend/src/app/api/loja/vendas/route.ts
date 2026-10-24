import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { mesYYYYMM } from "@/lib/schemas";
import { arred, num, tz } from "@/lib/servicos";

const query = z.object({ mes: mesYYYYMM.optional(), limite: z.coerce.number().int().min(1).max(1000).default(500) });

export const GET = api({ auth: ["loja"], query }, async ({ usuario, query }) => {
  const id = usuario.id;
  const linhas = query.mes
    ? await prisma().$queryRaw<{ id: number; cliente: string | null; produto: string; valor: string; data: Date }[]>`
        SELECT id, nome_cliente AS cliente, materiais_desc AS produto, valor::text AS valor, criado_em AS data
        FROM transacoes
        WHERE id_loja = ${id} AND tipo = 'debito'
          AND to_char(criado_em AT TIME ZONE ${tz()}, 'YYYY-MM') = ${query.mes}
        ORDER BY criado_em DESC, id DESC LIMIT ${query.limite}`
    : await prisma().$queryRaw<{ id: number; cliente: string | null; produto: string; valor: string; data: Date }[]>`
        SELECT id, nome_cliente AS cliente, materiais_desc AS produto, valor::text AS valor, criado_em AS data
        FROM transacoes WHERE id_loja = ${id} AND tipo = 'debito'
        ORDER BY criado_em DESC, id DESC LIMIT ${query.limite}`;
  const vendas = linhas.map((v) => ({ ...v, valor: num(v.valor) }));
  return { sucesso: true, total_vendas: vendas.length, total_debitado: arred(vendas.reduce((s, v) => s + v.valor, 0)), vendas };
});
