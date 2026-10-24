import { api } from "@/lib/api";
const mapa = { admin: "/admin", loja: "/loja", cliente: "/cliente" } as const;
export const GET = api({ auth: ["cliente", "loja", "admin"] }, async ({ usuario }) => ({ url: mapa[usuario.tipo] ?? "/login" }));
