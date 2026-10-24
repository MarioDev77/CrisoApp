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
  const [total, lista, met, alertasRaw] = await Promise.all([
    prisma().qrCode.count({ where }),
    prisma().qrCode.findMany({ where, orderBy: { criadoEm: "desc" }, skip: (query.pagina - 1) * query.por_pagina, take: query.por_pagina }),
    prisma().$queryRaw<{ ativos: number; usados: number; expirados: number; hoje: number }[]>`
      SELECT count(*) FILTER (WHERE status='ativo' AND expira_em >= now())::int AS ativos,
             count(*) FILTER (WHERE status='usado')::int AS usados,
             count(*) FILTER (WHERE status='expirado' OR (status='ativo' AND expira_em < now()))::int AS expirados,
             count(*) FILTER (WHERE (criado_em AT TIME ZONE ${tz()})::date = (now() AT TIME ZONE ${tz()})::date)::int AS hoje
      FROM qr_codes`,
    prisma().$queryRaw<{ categoria: string; alvo: string; usos: number; ip: string | null; data: Date }[]>`
      WITH recentes AS (SELECT id_loja, id_cliente, ip_gerado, usado_em FROM qr_codes WHERE status='usado' AND usado_em >= now() - interval '15 minutes'),
      alertas AS (
        SELECT 'loja'::text categoria, id_loja::text alvo, count(*)::int usos, NULL::text ip, max(usado_em) data FROM recentes GROUP BY id_loja HAVING count(*) > 5
        UNION ALL
        SELECT 'cliente', id_cliente::text, count(*)::int, NULL::text, max(usado_em) FROM recentes WHERE id_cliente IS NOT NULL GROUP BY id_cliente HAVING count(*) > 5
        UNION ALL
        SELECT 'ip', ip_gerado, count(*)::int, ip_gerado, max(usado_em) FROM recentes WHERE ip_gerado IS NOT NULL AND ip_gerado <> '' GROUP BY ip_gerado HAVING count(*) > 5
      ) SELECT * FROM alertas ORDER BY usos DESC LIMIT 20`,
  ]);
  const alertas = alertasRaw.map((a) => ({ tipo: `Uso múltiplo por ${a.categoria}`, descricao: `${a.usos} QR Codes usados nos últimos 15 minutos; identificador ${a.alvo}`, ip: a.ip, data: a.data.toISOString() }));
  return {
    total,
    metricas: { ativos: met[0].ativos, usados: met[0].usados, expirados: met[0].expirados, total_hoje: met[0].hoje },
    qrcodes: lista.map((q) => ({
      id_transacao: q.idTransacao, id_loja: q.idLoja, nome_loja: q.nomeLoja,
      valor: num(q.valor), criado_em: q.criadoEm, expira_em: q.expiraEm,
      status: q.expiraEm < agora && q.status === "ativo" ? "expirado" : q.status, usado_em: q.usadoEm,
    })),
    alertas,
  };
});
