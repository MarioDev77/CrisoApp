import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditar, taxasVigentes } from "@/lib/servicos";

export const GET = api({ auth: ["admin"] }, async () => taxasVigentes());

const taxa = (padrao: number) => z.coerce.number().int().min(1).max(10000).catch(padrao);
const body = z.object({ papelao: taxa(7), plastico: taxa(10), aluminio: taxa(6), vidro: taxa(4) });

export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  await prisma().configuracao.upsert({ where: { chave: "taxas" }, create: { chave: "taxas", valor: body }, update: { valor: body } });
  await auditar("admin_alterou_taxas", JSON.stringify(body), ip, usuario.id);
  return { sucesso: true, taxas: body };
});
