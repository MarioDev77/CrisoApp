import { env } from "./env";

/**
 * IP do cliente SOMENTE a partir de cabeçalhos que a infraestrutura garante.
 * Em TRUSTED_PROXY=none nenhum cabeçalho é confiável (evita spoofing de X-Forwarded-For).
 */
export function clientIp(headers: Headers): string {
  const e = env();
  if (e.TRUSTED_PROXY === "cloudflare") {
    const ip = headers.get("cf-connecting-ip");
    if (ip) return ip.trim().slice(0, 64);
  } else if (e.TRUSTED_PROXY === "hops") {
    const lista = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const ip = lista[lista.length - e.TRUSTED_PROXY_HOPS];
    if (ip) return ip.slice(0, 64);
  }
  return "desconhecido";
}
