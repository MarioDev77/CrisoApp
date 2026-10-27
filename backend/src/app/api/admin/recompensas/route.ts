import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { recompensaCriar } from "@/lib/recompensas";
import { auditar, num } from "@/lib/servicos";

const mapear = (r: { id: number; nome: string; descricao: string; categoria: string; custo: unknown; estoque: number | null; limitePorCliente: number | null; ativo: boolean; disponivelAte: Date | null; validadeDias: number; regras: string; idLoja: number | null; loja?: { nome: string } | null }, resgates = 0) => ({
  id: r.id, nome: r.nome, descricao: r.descricao, categoria: r.categoria, custo: num(r.custo as number), estoque: r.estoque, limite_por_cliente: r.limitePorCliente, ativo: r.ativo,
  disponivel_ate: r.disponivelAte, validade_dias: r.validadeDias, regras: r.regras, id_loja: r.idLoja, estabelecimento: r.loja?.nome ?? null, resgates,
});

export const GET = api({ auth: ["admin"] }, async () => {
  const [lista, contagem, lojas] = await Promise.all([
    prisma().recompensa.findMany({ include: { loja: { select: { nome: true } } }, orderBy: [{ ativo: "desc" }, { id: "desc" }], take: 300 }),
    prisma().resgateRecompensa.groupBy({ by: ["idRecompensa"], where: { status: { not: "cancelado" } }, _count: { _all: true } }),
    prisma().loja.findMany({ where: { status: "ativo", deletadoEm: null }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);
  const c = new Map(contagem.map((x) => [x.idRecompensa, x._count._all]));
  return { sucesso: true, recompensas: lista.map((r) => mapear(r, c.get(r.id) ?? 0)), lojas };
});

export const POST = api({ auth: ["admin"], body: recompensaCriar }, async ({ usuario, body, ip }) => {
  if (body.idLoja && !(await prisma().loja.findFirst({ where: { id: body.idLoja, status: "ativo", deletadoEm: null } }))) throw new HttpError(400, "Estabelecimento inválido.");
  const r = await prisma().recompensa.create({ data: body });
  await auditar("admin_criou_recompensa", `recompensa=${r.id} custo=${body.custo}`, ip, usuario.id);
  return { sucesso: true, id: r.id };
});
