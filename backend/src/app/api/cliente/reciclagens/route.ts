import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { MATERIAIS, type Material } from "@/lib/materiais";
import { paginacao } from "@/lib/schemas";
import { arred, limitesAntifraude, num } from "@/lib/servicos";

const query = z.object({ pagina: paginacao.pagina, material: z.enum(MATERIAIS).optional() });
const POR_PAGINA = 15;
const unidadesDe = (m: unknown) => {
  const o = (m ?? {}) as Record<string, unknown>;
  return Object.fromEntries(MATERIAIS.map((k) => [k, Math.max(0, Math.trunc(Number(o[k]) || 0))])) as Record<Material, number>;
};

/** Acompanhamento das reciclagens confirmadas DO PRÓPRIO cliente (id vem da sessão). */
export const GET = api({ auth: ["cliente"], query }, async ({ usuario, query }) => {
  const db = prisma();
  const limites = await limitesAntifraude();
  const filtroMaterial = query.material ? { materiais: { path: [query.material], gt: 0 } } : {};
  const where = { idCliente: usuario.id, tipo: "credito" as const, categoria: "reciclagem" as const, ...filtroMaterial };
  const [total, lista, porMaterial] = await Promise.all([
    db.transacao.count({ where }),
    db.transacao.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], skip: (query.pagina - 1) * POR_PAGINA, take: POR_PAGINA }),
    db.$queryRaw<Record<string, string>[]>`
      SELECT COALESCE(sum(NULLIF(materiais->>'papelao','')::numeric),0)::text AS papelao,
             COALESCE(sum(NULLIF(materiais->>'plastico','')::numeric),0)::text AS plastico,
             COALESCE(sum(NULLIF(materiais->>'aluminio','')::numeric),0)::text AS aluminio,
             COALESCE(sum(NULLIF(materiais->>'vidro','')::numeric),0)::text AS vidro
      FROM transacoes WHERE id_cliente = ${usuario.id} AND tipo = 'credito' AND categoria = 'reciclagem'`,
  ]);
  const agora = Date.now();
  return {
    sucesso: true, total, por_pagina: POR_PAGINA,
    totais_por_material: Object.fromEntries(MATERIAIS.map((m) => [m, num(porMaterial[0]?.[m])])),
    reciclagens: lista.map((t) => {
      const fim = t.criadoEm.getTime() + limites.carencia_horas * 3_600_000;
      return {
        id: t.id, referencia_qr: t.idQrTransacao, criado_em: t.criadoEm, loja: t.nomeLoja, materiais: unidadesDe(t.materiais), descricao: t.materiaisDesc,
        kg: arred(num(t.kg)), creditos: arred(num(t.valor)),
        status: fim > agora ? "em_carencia" : "concluido", status_rotulo: fim > agora ? "Em carência" : "Concluído", disponivel_em: fim > agora ? new Date(fim) : null,
      };
    }),
  };
});
