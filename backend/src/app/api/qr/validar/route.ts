import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { limitesAntifraude, num } from "@/lib/servicos";
import { calcularKg, MATERIAIS, type Material } from "@/lib/materiais";
import { decifrarDadosQr, tokenHashQr } from "@/lib/pii";
import { codigoCurtoDe } from "@/lib/qr-codigo";

const body = z.object({ token: z.string({ error: "Token ausente" }).trim().min(1, "Token ausente").max(255) });

export const POST = api(
  { auth: ["cliente"], body, limites: [{ nome: "qr-validar", por: "usuario", max: 10, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." }] },
  async ({ body }) => {
    const curto = codigoCurtoDe(body.token);
    const qr = await prisma().qrCode.findFirst({ where: { OR: [{ token: body.token }, ...(tokenHashQr(body.token) ? [{ tokenHash: tokenHashQr(body.token) }] : []), ...(curto ? [{ codigoCurto: curto }] : [])] } });
    if (!qr) throw new HttpError(404, "QR Code nao encontrado", { valido: false });
    if (qr.status !== "ativo") throw new HttpError(400, "QR Code ja utilizado ou expirado", { valido: false });
    if (qr.expiraEm < new Date()) {
      await prisma().qrCode.updateMany({ where: { token: qr.token, status: "ativo" }, data: { status: "expirado" } });
      throw new HttpError(400, "QR Code expirado", { valido: false });
    }
    const dados = decifrarDadosQr(qr);
    // Detalhamento para o cliente conferir antes de confirmar (só leitura; o servidor recalcula tudo na confirmação).
    let materiais: Record<Material, number> | null = null;
    let kg = 0;
    if (qr.tipo === "credito") {
      const bruto = (dados.materiais ?? {}) as Record<string, unknown>;
      materiais = Object.fromEntries(MATERIAIS.map((m) => [m, Math.max(0, Math.trunc(Number(bruto[m]) || 0))])) as Record<Material, number>;
      kg = calcularKg(materiais);
    }
    const { carencia_horas } = await limitesAntifraude();
    return {
      valido: true, id_transacao: qr.idTransacao, tipo: qr.tipo, valor: Number(dados.valor) || num(qr.valor), id_loja: qr.idLoja,
      nome_loja: qr.nomeLoja, descricao_material: dados.materiaisDesc, produto: dados.produto, expira_em: qr.expiraEm,
      materiais, kg, carencia_horas: qr.tipo === "credito" ? carencia_horas : 0,
    };
  },
);
