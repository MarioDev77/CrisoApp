import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  async rewrites() {
    // O SPA atende tudo que NÃO é API. Com "/:path*" o rewrite (afterFiles) roda antes das rotas dinâmicas do App Router
    // e engolia /api/**/[id]/** (bloquear, desbloquear, remover, aprovar loja, resgates...), devolvendo o index.html.
    return { afterFiles: [{ source: "/((?!api(?:/|$)|_next/).*)", destination: "/web/index.html" }] };
  },
};
export default config;
