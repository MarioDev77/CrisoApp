import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  async rewrites() {
    return { afterFiles: [{ source: "/:path*", destination: "/web/index.html" }] };
  },
};
export default config;
