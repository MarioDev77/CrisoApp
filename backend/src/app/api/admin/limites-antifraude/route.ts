import { z } from "zod";
import { api } from "@/lib/api";
import { alterarConfiguracao } from "@/lib/auditoria-admin";
import { limitesAntifraude } from "@/lib/servicos";

const body = z.object({
  credito_loja_dia: z.coerce.number().positive().max(1_000_000),
  credito_cliente_dia: z.coerce.number().positive().max(100_000),
  resgate_cliente_dia: z.coerce.number().positive().max(100_000),
  carencia_horas: z.coerce.number().min(0).max(720),
});

export const GET = api({ auth: ["admin"] }, async () => ({ limites: await limitesAntifraude() }));
export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  await alterarConfiguracao({ chave: "limites_antifraude", valor: body, acao: "admin_alterou_limites_antifraude", usuarioId: usuario.id, ip });
  return { sucesso: true };
});
