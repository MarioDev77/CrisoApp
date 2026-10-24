import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError, notFound } from "@/lib/errors";
import { calcularCreditos, descricao, materiaisSchema } from "@/lib/materiais";
import { configQr, taxasVigentes } from "@/lib/servicos";
import { camposQrCode } from "@/lib/pii";

const VALOR_MAXIMO_DEBITO = 100000;
const body = z.object({
  tipo: z.enum(["credito", "debito"]).default("credito"),
  valor: z.coerce.number().optional(),
  produto: z.string().trim().max(255).optional(),
  materiais: z.lazy(() => materiaisSchema()).optional(),
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
      const qr = await prisma().qrCode.create({
        data: { token, ...camposQrCode(token, ip, { valor: Math.round(v * 100) / 100, materiaisDesc: body.produto, produto: body.produto }), idLoja: loja.id, nomeLoja: loja.nome, tipo: "debito", valor: Math.round(v * 100) / 100, materiaisDesc: body.produto, produto: body.produto, ipGerado: ip, expiraEm },
      });
      return { sucesso: true, token, id_transacao: qr.idTransacao, expira_em: expiraEm.toISOString() };
    }

    // Crédito: o valor é SEMPRE recalculado no servidor; teto de unidades por material (anti-fraude).
    const mat = body.materiais ?? { papelao: 0, plastico: 0, aluminio: 0, vidro: 0 };
    const valor = calcularCreditos(mat, await taxasVigentes());
    if (valor <= 0) throw new HttpError(400, "Quantidade insuficiente para gerar credito");
    const qr = await prisma().qrCode.create({
      data: { token, ...camposQrCode(token, ip, { valor, materiais: mat, materiaisDesc: descricao(mat), produto: null }), idLoja: loja.id, nomeLoja: loja.nome, tipo: "credito", valor, materiais: mat, materiaisDesc: descricao(mat), ipGerado: ip, expiraEm },
    });
    return { sucesso: true, token, id_transacao: qr.idTransacao, expira_em: expiraEm.toISOString() };
  },
);
