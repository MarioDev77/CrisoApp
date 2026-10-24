export const dynamic = "force-dynamic";
/** Liveness: o processo responde. Não toca no banco (use /api/ready para prontidão). */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
