import { NextResponse } from "next/server";
import { COOKIE, emitirSessao, opcoesCookie, type Perfil } from "./auth";
import { env } from "./env";

export async function respostaComSessao(
  corpo: Record<string, unknown>,
  p: { id: number; tipo: Perfil; versao: number },
  status = 200,
) {
  const token = await emitirSessao(p);
  const res = NextResponse.json(env().LEGACY_BEARER ? { ...corpo, token } : corpo, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  res.cookies.set(COOKIE, token, opcoesCookie());
  return res;
}
