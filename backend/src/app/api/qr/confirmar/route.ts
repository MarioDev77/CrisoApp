import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { calcularCreditos, calcularKg, MATERIAIS, type Material } from "@/lib/materiais";
import { Prisma } from "@/generated/prisma/client";
import { arred, auditar, limitesAntifraude, num, taxasVigentes, tz } from "@/lib/servicos";
import { decifrarDadosQr, ipDoQr, tokenHashQr } from "@/lib/pii";
import { codigoCurtoDe } from "@/lib/qr-codigo";

const KG_MAXIMO = 200;
const MAX_CREDITOS_DIA = 5;
const MAX_DEBITOS_DIA = 10;
const body = z.object({ token: z.string({ error: "Token ausente" }).trim().min(1, "Token ausente").max(255), id_transacao: z.coerce.number().optional() });

type QrRow = { token: string; id_loja: number; nome_loja: string | null; tipo: "credito" | "debito"; valor: string; materiais: unknown; materiais_desc: string; produto: string | null; dados_enc: string | null; status: string; ip_gerado: string | null; ip_enc: string | null; expira_em: Date };
type Resultado =
  | { ok: true; msg: string; saldo: number }
  | { ok: false; status: number; msg: string; auditoria?: { acao: string; detalhe: string; idCliente: number } };

export const POST = api(
  { auth: ["cliente"], body, limites: [{ nome: "qr-confirmar", por: "usuario", max: 20, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." }] },
  async ({ usuario, body, ip }) => {
    const [taxas, limites] = await Promise.all([taxasVigentes(), limitesAntifraude()]);
    const r: Resultado = await prisma().$transaction(
      async (tx): Promise<Resultado> => {
        // Trava o QR e o cliente: confirmações simultâneas do mesmo QR serializam aqui.
        const hashedToken = tokenHashQr(body.token);
        const curto = codigoCurtoDe(body.token);
        const qrs = await tx.$queryRaw<QrRow[]>`
          SELECT token, id_loja, nome_loja, tipo::text AS tipo, valor::text AS valor, materiais, materiais_desc, produto, dados_enc, status::text AS status, ip_gerado, ip_enc, expira_em
          FROM qr_codes WHERE token = ${body.token} OR token_hash = ${hashedToken} OR codigo_curto = ${curto} FOR UPDATE`;
        const qr = qrs[0];
        if (!qr) return { ok: false, status: 404, msg: "QR Code nao encontrado" };
        if (qr.status !== "ativo") return { ok: false, status: 400, msg: "QR Code ja utilizado ou expirado" };
        if (qr.expira_em < new Date()) {
          await tx.qrCode.update({ where: { token: qr.token }, data: { status: "expirado" } });
          return { ok: false, status: 400, msg: "QR Code expirado" };
        }
        const lock = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM usuarios WHERE id = ${usuario.id} AND tipo = 'cliente' AND status = 'ativo' AND deletado_em IS NULL FOR UPDATE`;
        if (lock.length === 0) return { ok: false, status: 404, msg: "Cliente nao encontrado" };
        const cli = await tx.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
        if (!cli.emailVerificado) return { ok: false, status: 403, msg: "Confirme seu e-mail antes de confirmar um QR Code." };

        const qrIp = ipDoQr({ ipGerado: qr.ip_gerado, ipEnc: qr.ip_enc });
        if (qrIp && ip !== "desconhecido" && qrIp !== ip) {
          await auditar("ip_divergente", "QR gerado por IP diferente do cliente", ip, cli.id, tx);
        }
        const qrDados = decifrarDadosQr({ dadosEnc: qr.dados_enc, valor: qr.valor, materiais: qr.materiais, materiaisDesc: qr.materiais_desc, produto: qr.produto });
        const valor = Number(qrDados.valor);
        const usoHoje = async (t: "credito" | "debito") => {
          const c = await tx.$queryRaw<{ total: number }[]>`
            SELECT count(*)::int AS total FROM transacoes
            WHERE id_cliente = ${cli.id} AND tipo = ${t}::"TransacaoTipo"
              AND (criado_em AT TIME ZONE ${tz()})::date = (now() AT TIME ZONE ${tz()})::date`;
          return c[0].total;
        };
        const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

        if (qr.tipo === "debito") {
          const n = await usoHoje("debito");
          if (n >= MAX_DEBITOS_DIA) {
            await auditar("limite_diario_debito", `Tentativa bloqueada - ${n} debitos hoje`, ip, cli.id, tx);
            return { ok: false, status: 429, msg: "Limite diario de uso de moedas atingido" };
          }
          if (num(cli.saldo) < valor) return { ok: false, status: 400, msg: "Saldo insuficiente" };
          const novo = await tx.usuario.update({ where: { id: cli.id }, data: { saldo: { decrement: dec(valor) }, totalUtilizado: { increment: dec(valor) } } });
          await tx.qrCode.update({ where: { token: qr.token }, data: { status: "usado", usadoEm: new Date(), idCliente: cli.id } });
          await tx.transacao.create({
            data: { idCliente: cli.id, nomeCliente: cli.nome, idLoja: qr.id_loja, nomeLoja: qr.nome_loja, tipo: "debito", categoria: "resgate", valor: dec(valor), kg: 0, materiaisDesc: qrDados.produto || qrDados.materiaisDesc || "-", forma: "loja" },
          });
          return { ok: true, msg: "Moedas debitadas com sucesso!", saldo: num(novo.saldo) };
        }

        const n = await usoHoje("credito");
        if (n >= MAX_CREDITOS_DIA) {
          await auditar("limite_diario", `Tentativa bloqueada - ${n} usos hoje`, ip, cli.id, tx);
          return { ok: false, status: 429, msg: "Limite diario de reciclagens atingido" };
        }
        const bruto = (qrDados.materiais ?? {}) as Record<string, unknown>;
        const mat = Object.fromEntries(MATERIAIS.map((m) => [m, Math.max(0, Math.trunc(Number(bruto[m]) || 0))])) as Record<Material, number>;
        const kg = calcularKg(mat);
        const calculado = calcularCreditos(mat, taxas);
        if (Math.abs(valor - calculado) > 0.01) {
          return { ok: false, status: 400, msg: "Valor do QR invalido", auditoria: { acao: "valor_adulterado", detalhe: `QR valor=${valor} mas calculado=${calculado}`, idCliente: cli.id } };
        }
        if (kg > KG_MAXIMO) {
          return { ok: false, status: 400, msg: "Volume acima do permitido para uma unica reciclagem", auditoria: { acao: "volume_suspeito", detalhe: `${kg}kg numa unica transacao (limite: ${KG_MAXIMO}kg)`, idCliente: cli.id } };
        }
        // Serializa créditos da mesma loja e aplica tetos diários configuráveis.
        await tx.$queryRaw`SELECT id FROM lojas WHERE id = ${qr.id_loja} FOR UPDATE`;
        const [totalLoja, totalCliente] = await Promise.all([
          tx.$queryRaw<{ total: string }[]>`SELECT COALESCE(SUM(valor), 0)::text AS total FROM transacoes WHERE id_loja = ${qr.id_loja} AND tipo = 'credito'::"TransacaoTipo" AND (criado_em AT TIME ZONE ${tz()})::date = (now() AT TIME ZONE ${tz()})::date`,
          tx.$queryRaw<{ total: string }[]>`SELECT COALESCE(SUM(valor), 0)::text AS total FROM transacoes WHERE id_cliente = ${cli.id} AND tipo = 'credito'::"TransacaoTipo" AND (criado_em AT TIME ZONE ${tz()})::date = (now() AT TIME ZONE ${tz()})::date`,
        ]);
        const antesLoja = Number(totalLoja[0].total);
        const antesCliente = Number(totalCliente[0].total);
        if (antesLoja + valor > limites.credito_loja_dia) {
          await auditar("limite_credito_diario_loja", `Tentativa bloqueada; limite diario de creditos da loja atingido`, ip, cli.id, tx);
          return { ok: false, status: 429, msg: "Limite diário de créditos da loja atingido" };
        }
        if (antesCliente + valor > limites.credito_cliente_dia) {
          await auditar("limite_credito_diario_cliente", `Tentativa bloqueada; limite diario de creditos do cliente atingido`, ip, cli.id, tx);
          return { ok: false, status: 429, msg: "Limite diário de créditos da conta atingido" };
        }
        if (antesLoja < limites.credito_loja_dia * 0.8 && antesLoja + valor >= limites.credito_loja_dia * 0.8) {
          await auditar("alerta_credito_loja_80", `Loja atingiu 80% do limite diario de creditos`, ip, cli.id, tx);
        }
        const novo = await tx.usuario.update({
          where: { id: cli.id },
          data: { saldo: { increment: dec(valor) }, totalGanho: { increment: dec(valor) }, totalRecicladoKg: { increment: dec(kg) }, totalTrocas: { increment: 1 } },
        });
        await tx.qrCode.update({ where: { token: qr.token }, data: { status: "usado", usadoEm: new Date(), idCliente: cli.id } });
        await tx.transacao.create({
          data: { idCliente: cli.id, nomeCliente: cli.nome, idLoja: qr.id_loja, nomeLoja: qr.nome_loja, tipo: "credito", categoria: "reciclagem", valor: dec(valor), kg: dec(kg), materiais: mat, materiaisDesc: qrDados.materiaisDesc },
        });
        return { ok: true, msg: "Creditos adicionados com sucesso!", saldo: num(novo.saldo) };
      },
      { maxWait: 5000, timeout: 10000 },
    );

    if (!r.ok) {
      // auditoria fora da transação (não é perdida pelo rollback)
      if (r.auditoria) await auditar(r.auditoria.acao, r.auditoria.detalhe, ip, r.auditoria.idCliente);
      throw new HttpError(r.status, r.msg);
    }
    return { sucesso: true, mensagem: r.msg, novo_saldo: arred(r.saldo) };
  },
);
