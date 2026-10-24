import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
/** Readiness: verifica apenas se o banco responde. */
export async function GET() {
  try {
    await prisma().$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "indisponivel" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
