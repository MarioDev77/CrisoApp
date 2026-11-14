import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { calcularCreditos, descricao, materiaisSchema } from "@/lib/materiais";
import { configQr, taxasVigentes } from "@/lib/servicos";
import { camposQrCode } from "@/lib/pii";
import { formatarCodigo, novoCodigoCurto } from "@/lib/qr-codigo";
import { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

const VALOR_MAXIMO_DEBITO = 100000;
/** Gera o código curto e tenta de novo na (rara) colisão com outro código já guardado. */
async function comCodigoCurto<T>(criar: (codigo: string) => Promise<T>): Promise<{ qr: T; codigo: string }> {
  for (let i = 0; i < 5; i++) {
    const codigo = novoCodigoCurto();
    try { return { qr: await criar(codigo), codigo }; }
    catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; throw e; }
  }
  throw new HttpError(503, "Não foi possível gerar o código agora. Tente novamente.");
}

const body = z.object({
  tipo: z.enum(["credito", "debito"]).default("credito"),
  valor: z.coerce.number().optional(),
  produto: z.string().trim().max(255).optional(),
  materiais: z.lazy(() => materiaisSchema()).optional(),
  /** Cliente identificado pela loja (só crédito). O QR passa a valer apenas para ele. */
  id_cliente: z.coerce.number().int().positive().optional(),
});

export const POST = api(
  { auth: ["loja"], body, limites: [{ nome: "qr-gerar", por: "usuario", max: 30, janelaSeg: 60, msg: "Muitas requisicoes QR. Aguarde." }] },
  async ({ usuario, body, ip }) => {
    const loja = await prisma().loja.findUnique({ where: { id: usuario.id } });
    if (!loja) throw notFound("Loja nao encontrada");
    const { expiracao_segundos } = await configQr();
    const expiraEm = new Date(Date.now() + Math.min(expiracao_segundos, 60) * 1000);
    const token = randomUUID();

    if (body.tipo === "debito") {
      const v = body.valor;
      if (!v || v <= 0 || !Number.isFinite(v)) throw new HttpError(400, "Valor invalido");
      if (v > VALOR_MAXIMO_DEBITO) throw new HttpError(400, "Valor de desconto muito alto");
      if (!body.produto) throw new HttpError(400, "Informe o produto/servico utilizado");
      const produto: string = body.produto; // o TypeScript perde o estreitamento dentro do callback abaixo
      const { qr, codigo } = await comCodigoCurto((codigo) => prisma().qrCode.create({
        data: { token, codigoCurto: codigo, ...camposQrCode(token, ip, { valor: Math.round(v * 100) / 100, materiaisDesc: produto, produto: produto }), idLoja: loja.id, nomeLoja: loja.nome, tipo: "debito", valor: Math.round(v * 100) / 100, materiaisDesc: produto, produto: produto, ipGerado: ip, expiraEm },
      }));
      return { sucesso: true, token, codigo: formatarCodigo(codigo), id_transacao: qr.idTransacao, expira_em: expiraEm.toISOString() };
    }

    // Crédito: o valor é SEMPRE recalculado no servidor; teto de unidades por material (anti-fraude).
    if (!body.id_cliente && env().QR_CREDITO_EXIGE_CLIENTE) throw new HttpError(400, "Identifique o cliente antes de gerar o QR de crédito.");
    if (body.id_cliente) {
      const cliente = await prisma().usuario.findFirst({ where: { id: body.id_cliente, tipo: "cliente", status: "ativo", deletadoEm: null }, select: { id: true } });
      if (!cliente) throw new HttpError(400, "Cliente inválido ou inativo.");
    }
    const mat = body.materiais ?? { papelao: 0, plastico: 0, aluminio: 0, vidro: 0 };
    const valor = calcularCreditos(mat, await taxasVigentes());
    if (valor <= 0) throw new HttpError(400, "Quantidade insuficiente para gerar credito");
    const { qr, codigo } = await comCodigoCurto((codigo) => prisma().qrCode.create({
      data: { token, codigoCurto: codigo, ...camposQrCode(token, ip, { valor, materiais: mat, materiaisDesc: descricao(mat), produto: null }), idLoja: loja.id, idCliente: body.id_cliente ?? null, nomeLoja: loja.nome, tipo: "credito", valor, materiais: mat, materiaisDesc: descricao(mat), ipGerado: ip, expiraEm },
    }));
    // Métrica para decidir quando ligar QR_CREDITO_EXIGE_CLIENTE (sem dado pessoal): quantos créditos já saem com o cliente identificado.
    log.info("qr_credito_gerado", { vinculado: Boolean(body.id_cliente) });
    return { sucesso: true, token, codigo: formatarCodigo(codigo), id_transacao: qr.idTransacao, expira_em: expiraEm.toISOString() };
  },
);
