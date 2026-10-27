import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { num } from "./servicos";

type Db = Prisma.TransactionClient | PrismaClient;
type Linha = {
  id: number; tipo: "credito" | "debito"; categoria: "reciclagem" | "resgate"; valor: Prisma.Decimal | number | string | null; nomeLoja: string | null;
  materiaisDesc: string; forma: string; idQrTransacao: number | null; criadoEm: Date;
};

export type TipoOperacao = "reciclagem" | "resgate_pix" | "resgate_recompensa" | "desconto_loja" | "estorno" | "outro";
export const ROTULO_STATUS: Record<string, string> = {
  concluido: "Concluído", em_carencia: "Em carência", pendente: "Aguardando aprovação", aprovado: "Aprovado", pago: "Pago", cancelado: "Cancelado",
  voucher_ativo: "Voucher ativo", voucher_utilizado: "Voucher utilizado", voucher_cancelado: "Voucher cancelado", voucher_expirado: "Voucher expirado",
};

/**
 * Classifica cada lançamento do livro-razão (transacoes) e descobre seu status real:
 * resgates PIX e vouchers vêm das suas próprias tabelas; reciclagem depende da carência configurada.
 * Dois SELECTs em lote (não há consulta por linha).
 */
export async function anotarMovimentacoes(db: Db, linhas: Linha[], carenciaHoras: number, agora = new Date()) {
  const ids = linhas.map((l) => l.id);
  const [pix, vouchers] = ids.length
    ? await Promise.all([
        db.resgate.findMany({ where: { idTransacao: { in: ids } }, select: { idTransacao: true, status: true } }),
        db.resgateRecompensa.findMany({ where: { idTransacao: { in: ids } }, select: { idTransacao: true, status: true, expiraEm: true } }),
      ])
    : [[], []];
  const pixPorTransacao = new Map(pix.map((p) => [p.idTransacao, p.status]));
  const voucherPorTransacao = new Map(vouchers.map((v) => [v.idTransacao, v]));
  const fimCarencia = (criadoEm: Date) => new Date(criadoEm.getTime() + carenciaHoras * 3_600_000);

  return linhas.map((t) => {
    let tipoOperacao: TipoOperacao = "outro";
    let status = "concluido";
    let disponivelEm: Date | null = null;
    if (t.categoria === "reciclagem") {
      tipoOperacao = "reciclagem";
      const fim = fimCarencia(t.criadoEm);
      if (t.tipo === "credito" && fim > agora) { status = "em_carencia"; disponivelEm = fim; }
    } else if (t.tipo === "credito" && t.forma.startsWith("estorno")) {
      tipoOperacao = "estorno";
    } else if (t.forma === "recompensa") {
      tipoOperacao = "resgate_recompensa";
      const v = voucherPorTransacao.get(t.id);
      if (v) status = `voucher_${v.status === "ativo" && v.expiraEm < agora ? "expirado" : v.status}`;
    } else if (t.forma === "pix") {
      tipoOperacao = "resgate_pix";
      status = pixPorTransacao.get(t.id) ?? "pendente";
    } else if (t.forma === "loja") {
      tipoOperacao = "desconto_loja";
    }
    return {
      id: t.id, tipo: t.tipo, categoria: t.categoria, valor: num(t.valor), loja: t.nomeLoja, origem: t.nomeLoja ?? "CrisoVerde",
      materiais: t.materiaisDesc, tipo_operacao: tipoOperacao, status, status_rotulo: ROTULO_STATUS[status] ?? status,
      referencia_qr: t.idQrTransacao, disponivel_em: disponivelEm, criado_em: t.criadoEm,
    };
  });
}
