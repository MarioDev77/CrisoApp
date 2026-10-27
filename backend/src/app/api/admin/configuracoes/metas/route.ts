import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditar, metaMensalKg } from "@/lib/servicos";

const body = z.object({ meta_reciclagem_mensal_kg: z.coerce.number({ error: "Meta inválida" }).positive("A meta deve ser maior que zero").max(10_000).transform((n) => Math.round(n * 100) / 100) });

export const GET = api({ auth: ["admin"] }, async () => ({ meta_reciclagem_mensal_kg: await metaMensalKg() }));
export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  await prisma().configuracao.upsert({ where: { chave: "meta_reciclagem_mensal_kg" }, create: { chave: "meta_reciclagem_mensal_kg", valor: { kg: body.meta_reciclagem_mensal_kg } }, update: { valor: { kg: body.meta_reciclagem_mensal_kg } } });
  await auditar("admin_alterou_meta_reciclagem", `meta_kg=${body.meta_reciclagem_mensal_kg}`, ip, usuario.id);
  return { sucesso: true };
});
