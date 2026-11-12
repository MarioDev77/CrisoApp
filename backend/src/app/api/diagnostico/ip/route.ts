import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { resolverIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico operacional do IP do cliente. Protegido por CRON_SECRET (Authorization: Bearer ...).
 * Use UMA vez em produção para decidir TRUSTED_PROXY com dados, não por suposição:
 *   a) pelo domínio da Vercel (passa pelo rewrite)   b) direto no domínio do Railway
 * Compare seu IP público real com o que cada cabeçalho trouxe. Mostra IPs só a quem tem o segredo.
 */
export async function GET(req: Request) {
  const segredo = env().CRON_SECRET;
  const recebido = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(recebido), b = Buffer.from(segredo ?? "");
  if (!segredo || a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ sucesso: false, mensagem: "Não autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const h = req.headers;
  const info = resolverIp(h);
  const valor = (n: string) => h.get(n) ?? null;
  return Response.json({
    modo_configurado: info.modo,
    cabecalho_ip_configurado: env().CLIENT_IP_HEADER,
    ip_resolvido: info.ip,
    ip_confiavel: info.confiavel,
    motivo: info.motivo ?? null,
    cabecalhos_recebidos: {
      "x-real-ip": valor("x-real-ip"),
      "x-forwarded-for": valor("x-forwarded-for"),
      "x-vercel-forwarded-for": valor("x-vercel-forwarded-for"),
      "cf-connecting-ip": valor("cf-connecting-ip"),
    },
    presenca: {
      "x-vercel-id": h.has("x-vercel-id"),
      "x-railway-edge": h.has("x-railway-edge"),
      "x-origin-secret": h.has("x-origin-secret"),
    },
    como_ler: "Se x-real-ip/x-forwarded-for forem IPs da Vercel (iguais para qualquer visitante), NÃO use railway/hops: todos os usuários dividiriam o mesmo limite. Só use vercel com ORIGIN_SECRET e um cabeçalho que traga o seu IP real.",
  }, { headers: { "Cache-Control": "no-store" } });
}
