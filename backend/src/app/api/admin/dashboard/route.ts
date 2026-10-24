import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { arred, num, tz } from "@/lib/servicos";

export const GET = api({ auth: ["admin"] }, async () => {
  const z = tz();
  const db = prisma();
  const iniMes = db.$queryRaw<{ ini: Date }[]>`SELECT (date_trunc('month', now() AT TIME ZONE ${z}) AT TIME ZONE ${z}) AS ini`;
  const [[mes], cont, trocas, deb, usu, mats, prod, ativ, novos] = await Promise.all([
    iniMes,
    db.$queryRaw<{ clientes: number; lojas: number; pendentes: number }[]>`
      SELECT (SELECT count(*) FROM usuarios WHERE tipo='cliente')::int AS clientes,
             (SELECT count(*) FROM lojas)::int AS lojas,
             (SELECT count(*) FROM lojas WHERE status='pendente')::int AS pendentes`,
    db.$queryRaw<{ n: number; kg: string; v: string; kg_mes: string }[]>`
      SELECT count(*)::int AS n, COALESCE(sum(kg),0)::text AS kg, COALESCE(sum(valor),0)::text AS v,
             COALESCE(sum(kg) FILTER (WHERE criado_em >= date_trunc('month', now() AT TIME ZONE ${z}) AT TIME ZONE ${z}),0)::text AS kg_mes
      FROM transacoes WHERE tipo='credito'`,
    db.$queryRaw<{ n: number; v: string }[]>`SELECT count(*)::int AS n, COALESCE(sum(valor),0)::text AS v FROM transacoes WHERE tipo='debito'`,
    db.$queryRaw<{ total: number; ativos: number }[]>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE status='ativo')::int AS ativos FROM usuarios WHERE tipo='cliente'`,
    db.$queryRaw<{ papelao: string; plastico: string; aluminio: string; vidro: string }[]>`
      SELECT COALESCE(sum(NULLIF(materiais->>'papelao','')::numeric),0)::text AS papelao,
             COALESCE(sum(NULLIF(materiais->>'plastico','')::numeric),0)::text AS plastico,
             COALESCE(sum(NULLIF(materiais->>'aluminio','')::numeric),0)::text AS aluminio,
             COALESCE(sum(NULLIF(materiais->>'vidro','')::numeric),0)::text AS vidro
      FROM transacoes WHERE tipo='credito' AND criado_em >= date_trunc('month', now() AT TIME ZONE ${z}) AT TIME ZONE ${z}`,
    db.$queryRaw<{ produto: string; quantidade: number; total: string }[]>`
      SELECT COALESCE(NULLIF(materiais_desc,''),'-') AS produto, count(*)::int AS quantidade, COALESCE(sum(valor),0)::text AS total
      FROM transacoes WHERE tipo='debito' AND criado_em >= date_trunc('month', now() AT TIME ZONE ${z}) AT TIME ZONE ${z}
      GROUP BY 1 ORDER BY sum(valor) DESC LIMIT 15`,
    db.transacao.findMany({ orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 10 }),
    db.usuario.count({ where: { tipo: "cliente", criadoEm: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
  ]);
  void mes;
  const kgTotal = num(trocas[0].kg);
  return {
    total_clientes: cont[0].clientes, total_lojas: cont[0].lojas, lojas_pendentes: cont[0].pendentes,
    total_trocas: trocas[0].n, total_reciclado_kg: kgTotal, total_creditos: num(trocas[0].v),
    co2_evitado: arred(kgTotal * 0.5), kg_mes: num(trocas[0].kg_mes),
    total_resgates: deb[0].n, total_debitos: num(deb[0].v),
    produtos_resgatados_mes: prod.map((p) => ({ produto: p.produto, quantidade: p.quantidade, total: arred(num(p.total)) })),
    novos_usuarios_semana: novos,
    percentual_ativos: usu[0].total ? Math.round((usu[0].ativos / usu[0].total) * 100) : 0,
    materiais_mes: { papelao: num(mats[0].papelao), plastico: num(mats[0].plastico), aluminio: num(mats[0].aluminio), vidro: num(mats[0].vidro) },
    atividades: ativ.map((t) => ({
      tipo: num(t.valor) > 10 ? "alerta" : "info",
      descricao: `${t.tipo === "credito" ? "♻️" : "💰"} ${t.nomeCliente || "Cliente"}`,
      detalhe: `${t.tipo === "credito" ? "Reciclagem" : "Resgate"} de ${num(t.valor).toFixed(2).replace(".", ",")}`,
      tempo: t.criadoEm.toLocaleString("pt-BR", { timeZone: z }),
    })),
  };
});
