import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditar, limitesAntifraude } from "@/lib/servicos";

const body = z.object({
  credito_loja_dia: z.coerce.number().positive().max(1_000_000),
  credito_cliente_dia: z.coerce.number().positive().max(100_000),
  resgate_cliente_dia: z.coerce.number().positive().max(100_000),
  carencia_horas: z.coerce.number().min(0).max(720),
});

export const GET = api({ auth: ["admin"] }, async () => ({ limites: await limitesAntifraude() }));
export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  await prisma().configuracao.upsert({ where: { chave: "limites_antifraude" }, create: { chave: "limites_antifraude", valor: body }, update: { valor: body } });
  await auditar("admin_alterou_limites_antifraude", JSON.stringify(body), ip, usuario.id);
  return { sucesso: true };
});
