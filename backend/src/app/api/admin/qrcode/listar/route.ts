import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { paginacao } from "@/lib/schemas";
import { num, tz } from "@/lib/servicos";

const query = z.object({
  pagina: paginacao.pagina,
  por_pagina: z.coerce.number().int().min(1).max(50).default(15),
  status: z.enum(["ativo", "usado", "expirado", "invalido"]).optional(),
});

export const GET = api({ auth: ["admin"], query }, async ({ query }) => {
  const agora = new Date();
  let where: Prisma.QrCodeWhereInput = {};
  if (query.status === "expirado") where = { status: "ativo", expiraEm: { lt: agora } };
  else if (query.status === "ativo") where = { status: "ativo", expiraEm: { gte: agora } };
  else if (query.status) where = { status: query.status };
  const [total, lista, met, usados] = await Promise.all([
    prisma().qrCode.count({ where }),
    prisma().qrCode.findMany({ where, orderBy: { criadoEm: "desc" }, skip: (query.pagina - 1) * query.por_pagina, take: query.por_pagina }),
    prisma().$queryRaw<{ ativos: number; usados: number; expirados: number; hoje: number }[]>`
      SELECT count(*) FILTER (WHERE status='ativo' AND expira_em >= now())::int AS ativos,
             count(*) FILTER (WHERE status='usado')::int AS usados,
             count(*) FILTER (WHERE status='expirado' OR (status='ativo' AND expira_em < now()))::int AS expirados,
             count(*) FILTER (WHERE (criado_em AT TIME ZONE ${tz()})::date = (now() AT TIME ZONE ${tz()})::date)::int AS hoje
      FROM qr_codes`,
    prisma().qrCode.count({ where: { status: "usado" } }),
  ]);
  const alertas = usados > 5 ? [{ tipo: "Uso multiplo", descricao: `${usados} QR Codes ja foram utilizados`, ip: "127.0.0.1", data: agora.toISOString() }] : [];
  return {
    total,
    metricas: { ativos: met[0].ativos, usados: met[0].usados, expirados: met[0].expirados, total_hoje: met[0].hoje },
    qrcodes: lista.map((q) => ({
      token_preview: "..." + q.token.slice(-6), id_transacao: q.idTransacao, id_loja: q.idLoja, nome_loja: q.nomeLoja,
      valor: num(q.valor), criado_em: q.criadoEm, expira_em: q.expiraEm,
      status: q.expiraEm < agora && q.status === "ativo" ? "expirado" : q.status, usado_em: q.usadoEm,
    })),
    alertas,
  };
});
