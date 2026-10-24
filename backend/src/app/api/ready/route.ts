import { prisma } from "@/lib/db";
import { limparExpirados } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
/** Readiness: o banco responde. Também faz a limpeza oportunista de contadores vencidos. */
export async function GET() {
  try {
    await prisma().$queryRaw`SELECT 1`;
    if (Math.random() < 0.05) void limparExpirados().catch(() => {});
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "indisponivel" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
