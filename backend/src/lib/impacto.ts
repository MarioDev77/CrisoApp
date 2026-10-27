import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { KG_POR_UNIDADE, MATERIAIS, type Material } from "./materiais";
import { arred, metaMensalKg, num, tz } from "./servicos";

export type Granularidade = "dia" | "semana" | "mes";
const DIA_MS = 86_400_000;
const MAX_DIAS = 366;

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD)").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Data inválida");

export const impactoQuery = z.object({
  dias: z.coerce.number().int().min(1).max(MAX_DIAS).optional(),
  de: dataIso.optional(),
  ate: dataIso.optional(),
  material: z.enum(MATERIAIS).optional(),
  loja: z.coerce.number().int().positive().max(2_147_483_647).optional(),
});
export type ImpactoQuery = z.infer<typeof impactoQuery>;

const paraMs = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const deMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const hojeNoFuso = (zona: string, agora = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(agora);

/** Resolve o período pedido (datas do calendário no fuso da aplicação) e valida os limites. */
export function resolverPeriodo(q: Pick<ImpactoQuery, "dias" | "de" | "ate">, hoje: string): { de: string; ate: string; dias: number } {
  let de: string; let ate: string;
  if (q.de || q.ate) {
    ate = q.ate ?? hoje;
    de = q.de ?? deMs(paraMs(ate) - 29 * DIA_MS);
  } else {
    ate = hoje;
    de = deMs(paraMs(hoje) - ((q.dias ?? 30) - 1) * DIA_MS);
  }
  if (paraMs(de) > paraMs(ate)) throw new HttpError(400, "A data inicial deve ser anterior ou igual à final.");
  const dias = Math.round((paraMs(ate) - paraMs(de)) / DIA_MS) + 1;
  if (dias > MAX_DIAS) throw new HttpError(400, `Período máximo de ${MAX_DIAS} dias.`);
  return { de, ate, dias };
}

export const periodoAnterior = (p: { de: string; dias: number }) => ({ de: deMs(paraMs(p.de) - p.dias * DIA_MS), ate: deMs(paraMs(p.de) - DIA_MS), dias: p.dias });
export const escolherGranularidade = (dias: number): Granularidade => (dias <= 62 ? "dia" : dias <= 190 ? "semana" : "mes");

export type PontoSerie = { periodo: string; operacoes: number; kg: number; unidades: number };
const inicioDe = (iso: string, g: Granularidade) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (g === "semana") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // segunda-feira (igual ao date_trunc('week') do PostgreSQL)
  if (g === "mes") d.setUTCDate(1);
  return d;
};
/** Completa com zeros os períodos sem registro, para o gráfico não "pular" datas. */
export function preencherSerie(pontos: PontoSerie[], de: string, ate: string, g: Granularidade): PontoSerie[] {
  const mapa = new Map(pontos.map((p) => [p.periodo, p]));
  const out: PontoSerie[] = [];
  const cursor = inicioDe(de, g);
  const fim = paraMs(ate);
  while (cursor.getTime() <= fim) {
    const chave = cursor.toISOString().slice(0, 10);
    out.push(mapa.get(chave) ?? { periodo: chave, operacoes: 0, kg: 0, unidades: 0 });
    if (g === "dia") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (g === "semana") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export const variacaoPercentual = (atual: number, anterior: number) => (anterior > 0 ? Math.round(((atual - anterior) / anterior) * 1000) / 10 : null);

type Filtros = { de: string; ate: string; material?: Material; loja?: number };
const unidadesSql = (material?: Material) =>
  material
    ? Prisma.sql`COALESCE(NULLIF(t.materiais->>${material}, '')::numeric, 0)`
    : Prisma.sql`(${Prisma.join(MATERIAIS.map((m) => Prisma.sql`COALESCE(NULLIF(t.materiais->>${m}, '')::numeric, 0)`), " + ")})`;

/**
 * Regra única de contagem: SOMENTE reciclagem confirmada (crédito de categoria "reciclagem").
 * Não entram estornos/resgates (outra categoria). Operações recusadas/expiradas de QR nunca viram transação, então não aparecem.
 * Tudo agregado no banco; nenhuma linha individual sai daqui (sem dados pessoais).
 */
async function resumo(f: Filtros, janela: { ini: Date; fim: Date }) {
  const unid = unidadesSql(f.material);
  const kg = f.material ? Prisma.sql`(${unid}) * ${KG_POR_UNIDADE}` : Prisma.sql`t.kg`;
  const where = Prisma.sql`t.tipo = 'credito' AND t.categoria = 'reciclagem' AND t.criado_em >= ${janela.ini} AND t.criado_em < ${janela.fim}
    ${f.loja ? Prisma.sql`AND t.id_loja = ${f.loja}` : Prisma.empty}
    ${f.material ? Prisma.sql`AND ${unid} > 0` : Prisma.empty}`;
  return { unid, kg, where };
}

async function janelaDe(de: string, ate: string) {
  const r = await prisma().$queryRaw<{ ini: Date; fim: Date }[]>`
    SELECT (${de}::date)::timestamp AT TIME ZONE ${tz()} AS ini, ((${ate}::date + 1)::timestamp AT TIME ZONE ${tz()}) AS fim`;
  return r[0];
}

async function totais(f: Filtros) {
  const j = await janelaDe(f.de, f.ate);
  const { unid, kg, where } = await resumo(f, j);
  const r = await prisma().$queryRaw<{ operacoes: number; unidades: string; kg: string; creditos: string; participantes: number; lojas: number }[]>`
    SELECT count(*)::int AS operacoes, COALESCE(sum(${unid}), 0)::text AS unidades, COALESCE(sum(${kg}), 0)::text AS kg,
           COALESCE(sum(t.valor), 0)::text AS creditos, count(DISTINCT t.id_cliente)::int AS participantes, count(DISTINCT t.id_loja)::int AS lojas
    FROM transacoes t WHERE ${where}`;
  const x = r[0];
  return { operacoes: x.operacoes, unidades: num(x.unidades), kg: arred(num(x.kg)), creditos: f.material ? null : arred(num(x.creditos)), participantes: x.participantes, lojas_ativas: x.lojas };
}

export async function calcularImpacto(q: ImpactoQuery) {
  const zona = tz();
  const periodo = resolverPeriodo(q, hojeNoFuso(zona));
  const ant = periodoAnterior(periodo);
  const f: Filtros = { de: periodo.de, ate: periodo.ate, material: q.material, loja: q.loja };
  const fAnt: Filtros = { ...f, de: ant.de, ate: ant.ate };
  const g = escolherGranularidade(periodo.dias);
  const j = await janelaDe(f.de, f.ate);
  const { unid, kg, where } = await resumo(f, j);
  const gTrunc = g === "dia" ? "day" : g === "semana" ? "week" : "month";
  const colunasMaterial = Prisma.join(MATERIAIS.map((m) => Prisma.sql`COALESCE(sum(COALESCE(NULLIF(t.materiais->>${m}, '')::numeric, 0)), 0)::text AS ${Prisma.raw(`u_${m}`)}, count(*) FILTER (WHERE COALESCE(NULLIF(t.materiais->>${m}, '')::numeric, 0) > 0)::int AS ${Prisma.raw(`o_${m}`)}`));

  const [atual, anterior, serieBruta, matRow, lojasRows, ativos, partAtivos, mes] = await Promise.all([
    totais(f),
    totais(fAnt),
    prisma().$queryRaw<{ periodo: string; operacoes: number; unidades: string; kg: string }[]>`
      SELECT to_char(date_trunc(${gTrunc}, t.criado_em AT TIME ZONE ${zona}), 'YYYY-MM-DD') AS periodo, count(*)::int AS operacoes,
             COALESCE(sum(${unid}), 0)::text AS unidades, COALESCE(sum(${kg}), 0)::text AS kg
      FROM transacoes t WHERE ${where} GROUP BY 1 ORDER BY 1`,
    prisma().$queryRaw<Record<string, string | number>[]>`SELECT ${colunasMaterial} FROM transacoes t WHERE ${where}`,
    prisma().$queryRaw<{ id: number; nome: string | null; operacoes: number; kg: string }[]>`
      SELECT t.id_loja AS id, max(t.nome_loja) AS nome, count(*)::int AS operacoes, COALESCE(sum(${kg}), 0)::text AS kg
      FROM transacoes t WHERE ${where} AND t.id_loja IS NOT NULL GROUP BY t.id_loja ORDER BY sum(${kg}) DESC, t.id_loja LIMIT 10`,
    prisma().$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM usuarios WHERE tipo = 'cliente' AND status = 'ativo' AND deletado_em IS NULL`,
    // Participação compara ativos com ativos: quem reciclou e hoje está bloqueado/removido não entra no numerador.
    prisma().$queryRaw<{ total: number }[]>`
      SELECT count(DISTINCT t.id_cliente)::int AS total FROM transacoes t
      JOIN usuarios u ON u.id = t.id_cliente AND u.tipo = 'cliente' AND u.status = 'ativo' AND u.deletado_em IS NULL WHERE ${where}`,
    metaMensalKg().then(async (meta) => {
      const r = await prisma().$queryRaw<{ participantes: number; atingiram: number; periodo: string }[]>`
        WITH m AS (
          SELECT id_cliente, sum(kg) AS kg FROM transacoes
          WHERE tipo = 'credito' AND categoria = 'reciclagem' AND id_cliente IS NOT NULL
            AND criado_em >= (date_trunc('month', now() AT TIME ZONE ${zona}) AT TIME ZONE ${zona})
          GROUP BY id_cliente)
        SELECT count(*)::int AS participantes, (count(*) FILTER (WHERE kg >= ${meta}))::int AS atingiram,
               to_char(date_trunc('month', now() AT TIME ZONE ${zona}), 'YYYY-MM') AS periodo FROM m`;
      return { meta, ...r[0] };
    }),
  ]);

  const mats = (matRow[0] ?? {}) as Record<string, string | number>;
  const por_material = MATERIAIS.filter((m) => !q.material || m === q.material).map((m) => {
    const unidades = num(mats[`u_${m}`]);
    return { material: m, operacoes: Number(mats[`o_${m}`] ?? 0), unidades, kg: arred(unidades * KG_POR_UNIDADE) };
  });
  const serie = preencherSerie(serieBruta.map((p) => ({ periodo: p.periodo, operacoes: p.operacoes, unidades: num(p.unidades), kg: arred(num(p.kg)) })), periodo.de, periodo.ate, g);
  const ativosTotal = ativos[0]?.total ?? 0;

  return {
    periodo: { ...periodo, granularidade: g, periodo_anterior: ant },
    filtros: { material: q.material ?? null, loja: q.loja ?? null },
    resumo: atual,
    anterior,
    variacao: { operacoes: variacaoPercentual(atual.operacoes, anterior.operacoes), kg: variacaoPercentual(atual.kg, anterior.kg), participantes: variacaoPercentual(atual.participantes, anterior.participantes) },
    por_material,
    serie,
    por_loja: lojasRows.map((l) => ({ id: l.id, nome: l.nome ?? `Loja #${l.id}`, operacoes: l.operacoes, kg: arred(num(l.kg)) })),
    participacao: { participantes: partAtivos[0]?.total ?? 0, clientes_ativos: ativosTotal, percentual: ativosTotal ? Math.round(((partAtivos[0]?.total ?? 0) / ativosTotal) * 1000) / 10 : 0 },
    meta_mensal: {
      mes: mes.periodo ?? null, meta_kg_por_cliente: mes.meta, participantes_no_mes: mes.participantes ?? 0, atingiram: mes.atingiram ?? 0,
      percentual_dos_participantes: mes.participantes ? Math.round(((mes.atingiram ?? 0) / mes.participantes) * 1000) / 10 : 0,
    },
    // Transparência: como os números são formados.
    metodologia: {
      conta: "Somente reciclagens confirmadas pelo cliente (crédito concluído). Resgates, estornos e QR Codes não utilizados ou expirados não entram.",
      kg: "Peso estimado pela regra da plataforma (0,05 kg por unidade, qualquer material), não pesagem real.",
      impacto_ambiental: "Nenhuma emissão evitada é calculada aqui: não há metodologia documentada para os dados coletados.",
    },
  };
}
