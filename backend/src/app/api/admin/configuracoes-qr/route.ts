import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/servicos";

const body = z.object({
  expiracao_segundos: z.coerce.number().int().min(1).max(300).catch(60),
  max_tentativas: z.coerce.number().int().min(1).max(20).catch(5),
});

export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  await prisma().configuracao.upsert({ where: { chave: "qr" }, create: { chave: "qr", valor: body }, update: { valor: body } });
  await auditar("admin_alterou_config_qr", JSON.stringify(body), ip, usuario.id);
  return { sucesso: true };
});
