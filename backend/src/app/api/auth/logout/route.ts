import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { COOKIE, opcoesCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Encerra a sessão em todos os dispositivos (incrementa a versão da sessão) e limpa o cookie. */
export const POST = api({ auth: ["cliente", "loja", "admin"] }, async ({ usuario }) => {
  if (usuario.tipo === "loja") await prisma().loja.update({ where: { id: usuario.id }, data: { versaoSessao: { increment: 1 } } });
  else await prisma().usuario.update({ where: { id: usuario.id }, data: { versaoSessao: { increment: 1 } } });
  const res = NextResponse.json({ sucesso: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(COOKIE, "", { ...opcoesCookie(0), maxAge: 0 });
  return res;
});
