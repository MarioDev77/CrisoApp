import { z } from "zod";
import { api } from "@/lib/api";
import { alterarConfiguracao } from "@/lib/auditoria-admin";

const body = z.object({
  expiracao_segundos: z.coerce.number().int().min(1).max(300).catch(60),
  max_tentativas: z.coerce.number().int().min(1).max(20).catch(5),
});

export const POST = api({ auth: ["admin"], body }, async ({ usuario, body, ip }) => {
  await alterarConfiguracao({ chave: "qr", valor: body, acao: "admin_alterou_config_qr", usuarioId: usuario.id, ip });
  return { sucesso: true };
});
