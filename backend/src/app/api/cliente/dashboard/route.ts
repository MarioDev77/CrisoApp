import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { carteiraDoCliente } from "@/lib/carteira";
import { anotarMovimentacoes } from "@/lib/extrato";
import { motivoIndisponivel } from "@/lib/recompensas";
import { arred, limitesAntifraude, metaMensalKg, num, tz } from "@/lib/servicos";

/** Painel inicial do aluno. Tudo filtrado pelo id da SESSÃO (nada vem do navegador). */
export const GET = api({ auth: ["cliente"], limites: [{ nome: "cliente-dashboard", por: "usuario", max: 60, janelaSeg: 60 }] }, async ({ usuario }) => {
  const db = prisma();
  const limites = await limitesAntifraude();
  const [carteira, meta, mes, operacoes, ultimas, catalogo, voucherAtivos] = await Promise.all([
    carteiraDoCliente(db, usuario.id, limites.carencia_horas),
    metaMensalKg(),
    db.$queryRaw<{ kg: string; operacoes: number }[]>`
      SELECT COALESCE(sum(kg), 0)::text AS kg, count(*)::int AS operacoes FROM transacoes
      WHERE id_cliente = ${usuario.id} AND tipo = 'credito' AND categoria = 'reciclagem'
        AND criado_em >= (date_trunc('month', now() AT TIME ZONE ${tz()}) AT TIME ZONE ${tz()})`,
    db.transacao.count({ where: { idCliente: usuario.id } }),
    db.transacao.findMany({ where: { idCliente: usuario.id }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 5 }),
    db.recompensa.findMany({ where: { ativo: true, OR: [{ disponivelAte: null }, { disponivelAte: { gt: new Date() } }] }, orderBy: [{ custo: "asc" }, { id: "asc" }], take: 100 }),
    db.resgateRecompensa.count({ where: { idCliente: usuario.id, status: "ativo", expiraEm: { gt: new Date() } } }),
  ]);
  const kgMes = arred(num(mes[0].kg));
  const disponiveis = catalogo.filter((r) => !motivoIndisponivel(r));
  const alcancaveis = disponiveis.filter((r) => num(r.custo) <= carteira.saldo);
  return {
    sucesso: true,
    carteira,
    resumo: { operacoes_totais: operacoes, reciclagens: carteira.total_trocas, total_reciclado_kg: carteira.total_reciclado_kg },
    meta_mensal: { meta_kg: meta, reciclado_kg: kgMes, operacoes_no_mes: mes[0].operacoes, percentual: Math.min(100, Math.round((kgMes / meta) * 100)), atingida: kgMes >= meta },
    ultimas_movimentacoes: await anotarMovimentacoes(db, ultimas, limites.carencia_horas),
    recompensas: {
      disponiveis: disponiveis.length, alcancaveis: alcancaveis.length, vouchers_ativos: voucherAtivos,
      destaques: alcancaveis.slice(0, 3).map((r) => ({ id: r.id, nome: r.nome, custo: num(r.custo) })),
    },
    // Campanhas e turmas ainda não existem no modelo de dados: não são simuladas.
    campanhas: null,
  };
});
