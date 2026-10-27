import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ROTULO_VOUCHER, statusVoucher } from "@/lib/recompensas";
import { num } from "@/lib/servicos";

/** Vouchers do próprio cliente (where por id da sessão: não existe parâmetro de id para trocar). */
export const GET = api({ auth: ["cliente"] }, async ({ usuario }) => {
  const lista = await prisma().resgateRecompensa.findMany({
    where: { idCliente: usuario.id }, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 100,
    include: { recompensa: { select: { regras: true, loja: { select: { nome: true } } } } },
  });
  return {
    sucesso: true,
    resgates: lista.map((v) => {
      const st = statusVoucher(v.status, v.expiraEm);
      return {
        id: v.id, nome: v.nomeRecompensa, custo: num(v.custo), codigo: v.codigo, status: st, status_rotulo: ROTULO_VOUCHER[st], criado_em: v.criadoEm, expira_em: v.expiraEm,
        usado_em: v.usadoEm, estabelecimento: v.recompensa.loja?.nome ?? null, regras: v.recompensa.regras, referencia_transacao: v.idTransacao,
        instrucoes: st === "ativo" ? "Apresente este código no estabelecimento antes do vencimento." : null,
      };
    }),
  };
});
