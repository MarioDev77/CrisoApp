import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { carteiraDoCliente } from "@/lib/carteira";
import { motivoIndisponivel } from "@/lib/recompensas";
import { limitesAntifraude, num } from "@/lib/servicos";

const query = z.object({ busca: z.string().trim().max(60).optional(), categoria: z.string().trim().max(50).optional() });

/** Catálogo (somente leitura). Preço, estoque e regras exibidos aqui são só informativos: o resgate reconfere tudo no servidor. */
export const GET = api({ auth: ["cliente"], query }, async ({ usuario, query }) => {
  const db = prisma();
  const limites = await limitesAntifraude();
  const base = { ativo: true, OR: [{ disponivelAte: null }, { disponivelAte: { gt: new Date() } }] };
  const [carteira, lista, categorias, feitos] = await Promise.all([
    carteiraDoCliente(db, usuario.id, limites.carencia_horas),
    db.recompensa.findMany({
      where: { ...base, ...(query.categoria ? { categoria: query.categoria } : {}), ...(query.busca ? { nome: { contains: query.busca, mode: "insensitive" as const } } : {}) },
      include: { loja: { select: { nome: true } } }, orderBy: [{ custo: "asc" }, { id: "asc" }], take: 100,
    }),
    db.recompensa.findMany({ where: base, distinct: ["categoria"], select: { categoria: true }, orderBy: { categoria: "asc" } }),
    db.resgateRecompensa.groupBy({ by: ["idRecompensa"], where: { idCliente: usuario.id, status: { not: "cancelado" } }, _count: { _all: true } }),
  ]);
  const jaResgatou = new Map(feitos.map((f) => [f.idRecompensa, f._count._all]));
  return {
    sucesso: true, saldo_disponivel: carteira.saldo, saldo_pendente: carteira.saldo_pendente, categorias: categorias.map((c) => c.categoria),
    recompensas: lista.map((r) => {
      const meus = jaResgatou.get(r.id) ?? 0;
      const motivo = motivoIndisponivel(r) ?? (r.limitePorCliente !== null && meus >= r.limitePorCliente ? "Limite de resgates atingido." : null);
      const custo = num(r.custo);
      return {
        id: r.id, nome: r.nome, descricao: r.descricao, categoria: r.categoria, custo, estoque: r.estoque, limite_por_cliente: r.limitePorCliente, ja_resgatadas: meus,
        disponivel_ate: r.disponivelAte, validade_dias: r.validadeDias, regras: r.regras, estabelecimento: r.loja?.nome ?? null,
        disponivel: motivo === null, motivo_indisponivel: motivo, saldo_suficiente: carteira.saldo >= custo,
      };
    }),
  };
});
