import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { MSG_PERFIL_INCOMPLETO, perfilCompleto } from "@/lib/perfil";
import { formatarCodigo, novoCodigoCurto } from "@/lib/qr-codigo";
import { motivoIndisponivel } from "@/lib/recompensas";
import { idParam } from "@/lib/schemas";
import { arred, auditar, limitesAntifraude, num } from "@/lib/servicos";
import { Prisma } from "@/generated/prisma/client";

// A chave identifica a TENTATIVA (gerada pelo navegador ao abrir a confirmação): reenviar a mesma chave nunca cobra duas vezes.
const body = z.object({ chave: z.string({ error: "Requisição inválida" }).trim().regex(/^[A-Za-z0-9_-]{16,64}$/, "Requisição inválida") });

type Row = { id: number; nome: string; custo: string; estoque: number | null; limite_por_cliente: number | null; ativo: boolean; disponivel_ate: Date | null; validade_dias: number; id_loja: number | null };

export const POST = api<z.infer<typeof body>, unknown, { id: string }>(
  { auth: ["cliente"], body, limites: [{ nome: "recompensa-resgatar", por: "usuario", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." }] },
  async ({ usuario, body, params, ip }) => {
    const idRecompensa = idParam.parse(params.id);
    const limites = await limitesAntifraude();
    const r = await prisma().$transaction(async (tx) => {
      // 1) Trava a conta: resgates simultâneos do mesmo aluno passam um de cada vez (mesmo padrão de /cliente/resgatar).
      const conta = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM usuarios WHERE id = ${usuario.id} AND tipo = 'cliente' AND status = 'ativo' AND deletado_em IS NULL FOR UPDATE`;
      if (!conta.length) throw new HttpError(404, "Conta não encontrada.");
      const cli = await tx.usuario.findUniqueOrThrow({ where: { id: usuario.id } });

      // 2) Idempotência: a mesma tentativa devolve o voucher já criado, sem novo débito.
      const repetido = await tx.resgateRecompensa.findUnique({ where: { idCliente_chave: { idCliente: usuario.id, chave: body.chave } } });
      if (repetido) {
        if (repetido.idRecompensa !== idRecompensa) throw new HttpError(409, "Requisição inválida.");
        return { voucher: repetido, saldo: num(cli.saldo), repetido: true };
      }
      if (!perfilCompleto(cli)) throw new HttpError(403, MSG_PERFIL_INCOMPLETO, { perfil_incompleto: true });

      // 3) Trava a recompensa e confere regras com os dados do BANCO (preço/estoque/validade nunca vêm do cliente).
      const rec = (await tx.$queryRaw<Row[]>`SELECT id, nome, custo::text AS custo, estoque, limite_por_cliente, ativo, disponivel_ate, validade_dias, id_loja FROM recompensas WHERE id = ${idRecompensa} FOR UPDATE`)[0];
      if (!rec) throw notFound("Recompensa não encontrada.");
      const indisponivel = motivoIndisponivel({ ativo: rec.ativo, disponivelAte: rec.disponivel_ate, estoque: rec.estoque });
      if (indisponivel) throw new HttpError(409, indisponivel);
      if (rec.limite_por_cliente !== null) {
        const feitos = await tx.resgateRecompensa.count({ where: { idCliente: usuario.id, idRecompensa, status: { not: "cancelado" } } });
        if (feitos >= rec.limite_por_cliente) throw new HttpError(409, "Limite de resgates desta recompensa atingido.");
      }

      // 4) Saldo DISPONÍVEL (exclui créditos de reciclagem em carência, igual ao resgate em dinheiro).
      const custo = arred(Number(rec.custo));
      const carencia = await tx.$queryRaw<{ total: string }[]>`
        SELECT COALESCE(SUM(valor), 0)::text AS total FROM transacoes
        WHERE id_cliente = ${usuario.id} AND tipo = 'credito'::"TransacaoTipo" AND categoria = 'reciclagem'::"TransacaoCat"
          AND criado_em > now() - make_interval(hours => ${limites.carencia_horas})`;
      const disponivel = Math.max(0, num(cli.saldo) - Number(carencia[0].total));
      if (disponivel < custo) throw new HttpError(400, "Saldo disponível insuficiente; créditos recentes podem estar em carência.");

      // 5) Débito atômico com guarda no próprio UPDATE (nunca deixa o saldo negativo).
      const debitado = await tx.$queryRaw<{ saldo: string }[]>`
        UPDATE usuarios SET saldo = saldo - ${custo}::numeric, total_utilizado = total_utilizado + ${custo}::numeric
        WHERE id = ${usuario.id} AND saldo >= ${custo}::numeric RETURNING saldo::text AS saldo`;
      if (!debitado.length) throw new HttpError(400, "Saldo insuficiente.");
      if (rec.estoque !== null) {
        const baixa = await tx.$executeRaw`UPDATE recompensas SET estoque = estoque - 1 WHERE id = ${idRecompensa} AND estoque > 0`;
        if (!baixa) throw new HttpError(409, "Esgotada.");
      }

      // 6) Lançamento no livro-razão existente + voucher.
      const loja = rec.id_loja ? await tx.loja.findUnique({ where: { id: rec.id_loja }, select: { nome: true } }) : null;
      const lanc = await tx.transacao.create({
        data: { idCliente: usuario.id, nomeCliente: cli.nome, idLoja: null, nomeLoja: loja?.nome ?? "CrisoVerde", tipo: "debito", categoria: "resgate", valor: custo, kg: 0, forma: "recompensa", materiaisDesc: `Recompensa: ${rec.nome}`.slice(0, 500) },
      });
      let codigo = novoCodigoCurto();
      for (let i = 0; i < 5 && (await tx.resgateRecompensa.count({ where: { codigo } })) > 0; i++) codigo = novoCodigoCurto();
      const voucher = await tx.resgateRecompensa.create({
        data: { idCliente: usuario.id, idRecompensa, nomeRecompensa: rec.nome, custo, codigo, chave: body.chave, idTransacao: lanc.id, expiraEm: new Date(Date.now() + rec.validade_dias * 86_400_000) },
      });
      await auditar("recompensa_resgatada", `voucher=${voucher.id} recompensa=${idRecompensa} custo=${custo}`, ip, usuario.id, tx);
      return { voucher, saldo: Number(debitado[0].saldo), repetido: false };
    }, { maxWait: 5000, timeout: 10000 }).catch((e: unknown) => {
      // Duas requisições iguais ao mesmo tempo (mesma chave): a segunda cai no UNIQUE, vem aqui e é tratada como conflito amigável.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "Resgate já em processamento. Confira seus vouchers.");
      throw e;
    });
    const v = r.voucher;
    return {
      sucesso: true, mensagem: r.repetido ? "Resgate já registrado." : "Recompensa resgatada!", novo_saldo: arred(r.saldo),
      voucher: { id: v.id, nome: v.nomeRecompensa, custo: num(v.custo), codigo: formatarCodigo(v.codigo), expira_em: v.expiraEm, status: "ativo" },
    };
  },
);
