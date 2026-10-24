import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api/");

  // Segredo opcional de origem para impedir acesso direto ao backend quando
  // Vercel/Cloudflare estiverem configurados para anexá-lo ao encaminhar /api.
  const originSecret = process.env.ORIGIN_SECRET;
  if (isApi && req.nextUrl.pathname !== "/api/health" && originSecret) {
    const recebido = req.headers.get("x-origin-secret") ?? "";
    const a = Buffer.from(recebido);
    const b = Buffer.from(originSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ sucesso: false, mensagem: "Origem não permitida" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  // CSRF: requisições que mudam estado só são aceitas de mesma origem.
  // (Defesa em profundidade além de cookie SameSite=Strict.)
  if (isApi && !SEGUROS.has(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    const site = req.headers.get("sec-fetch-site");
    // Origens extras confiáveis (ex.: front na Vercel repassando /api ao Railway). Ex.: ALLOWED_ORIGINS=https://criso-app.vercel.app
    const permitidas = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
    let ok = true;
    if (site && site !== "same-origin" && site !== "none") ok = false;
    if (origin && host) {
      try {
        const o = new URL(origin);
        if (o.host !== host && !permitidas.includes(o.origin)) ok = false;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      return NextResponse.json({ sucesso: false, mensagem: "Origem não permitida" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://accounts.google.com${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}' https://accounts.google.com`,
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "media-src 'self' blob: mediastream:",
    "font-src 'self'",
    "connect-src 'self' https://accounts.google.com",
    "frame-src https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (!dev) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
