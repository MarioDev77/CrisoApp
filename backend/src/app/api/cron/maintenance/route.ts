import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = env().CRON_SECRET;
  const recebido = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(secret ?? "");
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ sucesso: false, mensagem: "Não autorizado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const db = prisma();
  const [rateLimits, qrCodes, logs] = await Promise.all([
    db.$executeRaw`DELETE FROM rate_limits WHERE expira_em < now() - interval '1 hour'`,
    db.$executeRaw`DELETE FROM qr_codes WHERE status IN ('usado', 'expirado', 'invalido') AND expira_em < now() - interval '30 days'`,
    db.$executeRaw`DELETE FROM logs_auditoria WHERE criado_em < now() - interval '12 months'`,
  ]);
  return Response.json({ sucesso: true, removidos: { rate_limits: rateLimits, qr_codes: qrCodes, logs_auditoria: logs } }, { headers: { "Cache-Control": "no-store" } });
}
