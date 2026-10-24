import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { auditar } from "@/lib/servicos";

const body = z.object({
  token: z.string().trim().min(1).max(255).optional(),
  id_transacao: z.coerce.number().int().positive().optional(),
}).refine((v) => Boolean(v.token) !== Boolean(v.id_transacao), { message: "Informe token ou ID da transação" });

export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  // só invalida QR ainda ativo: não "desfaz" um QR já utilizado
  const where = body.token ? { token: body.token } : { idTransacao: body.id_transacao! };
  const r = await prisma().qrCode.updateMany({ where: { ...where, status: "ativo" }, data: { status: "invalido" } });
  if (r.count === 0) throw notFound("QR Code nao encontrado");
  await auditar("admin_invalidou_qrcode", body.token ? `token=...${body.token.slice(-6)}` : `id_transacao=${body.id_transacao}`, ip, usuario.id);
  return { sucesso: true };
});
