import { z } from "zod";
import { api } from "@/lib/api";
import { alterarConfiguracao } from "@/lib/auditoria-admin";
import { metaMensalKg } from "@/lib/servicos";

const body = z.object({ meta_reciclagem_mensal_kg: z.coerce.number({ error: "Meta inválida" }).positive("A meta deve ser maior que zero").max(10_000).transform((n) => Math.round(n * 100) / 100) });

export const GET = api({ auth: ["admin"] }, async () => ({ meta_reciclagem_mensal_kg: await metaMensalKg() }));
export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  await alterarConfiguracao({ chave: "meta_reciclagem_mensal_kg", valor: { kg: body.meta_reciclagem_mensal_kg }, acao: "admin_alterou_meta_reciclagem", usuarioId: usuario.id, ip });
  return { sucesso: true };
});
