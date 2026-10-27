import { z } from "zod";

export const ROTULO_VOUCHER: Record<string, string> = { ativo: "Ativo", utilizado: "Utilizado", cancelado: "Cancelado", expirado: "Expirado" };

/** O status gravado só vira "expirado" quando alguém age; para exibição, vencido por data conta como expirado. */
export const statusVoucher = (status: string, expiraEm: Date, agora = new Date()) => (status === "ativo" && expiraEm < agora ? "expirado" : status);

export type RecompensaRegra = { ativo: boolean; disponivelAte: Date | null; estoque: number | null };
/** null = pode ser resgatada. Texto = motivo mostrado ao aluno. */
export function motivoIndisponivel(r: RecompensaRegra, agora = new Date()): string | null {
  if (!r.ativo) return "Recompensa indisponível.";
  if (r.disponivelAte && r.disponivelAte < agora) return "Recompensa encerrada.";
  if (r.estoque !== null && r.estoque <= 0) return "Esgotada.";
  return null;
}

const texto = (max: number) => z.string().trim().max(max);
const dataOpcional = z.union([z.string().trim().min(1).transform((s, ctx) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) { ctx.addIssue({ code: "custom", message: "Data inválida" }); return z.NEVER; }
  return d;
}), z.null()]);

export const recompensaCampos = {
  nome: texto(120).min(2, "Informe o nome"),
  descricao: texto(1000),
  categoria: texto(50).min(1).regex(/^[\p{L}\p{N} _-]+$/u, "Categoria inválida"),
  custo: z.coerce.number({ error: "Custo inválido" }).positive("O custo deve ser maior que zero").max(100_000).transform((n) => Math.round(n * 100) / 100),
  estoque: z.union([z.coerce.number().int("Estoque inválido").min(0).max(1_000_000), z.null()]),
  limitePorCliente: z.union([z.coerce.number().int().min(1).max(1000), z.null()]),
  ativo: z.boolean(),
  disponivelAte: dataOpcional,
  validadeDias: z.coerce.number().int().min(1).max(365),
  regras: texto(2000),
  idLoja: z.union([z.coerce.number().int().positive(), z.null()]),
};

export const recompensaCriar = z.object({
  nome: recompensaCampos.nome,
  custo: recompensaCampos.custo,
  descricao: recompensaCampos.descricao.default(""),
  categoria: recompensaCampos.categoria.default("geral"),
  estoque: recompensaCampos.estoque.default(null),
  limitePorCliente: recompensaCampos.limitePorCliente.default(null),
  ativo: recompensaCampos.ativo.default(true),
  disponivelAte: recompensaCampos.disponivelAte.default(null),
  validadeDias: recompensaCampos.validadeDias.default(30),
  regras: recompensaCampos.regras.default(""),
  idLoja: recompensaCampos.idLoja.default(null),
});
export const recompensaAtualizar = z.object(recompensaCampos).partial().refine((o) => Object.keys(o).length > 0, "Nada para atualizar");

export const codigoVoucherSchema = z.string({ error: "Informe o código" }).trim().min(4).max(20);
