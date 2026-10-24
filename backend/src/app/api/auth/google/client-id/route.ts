import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ clientId: env().GOOGLE_CLIENT_ID || null });
}
