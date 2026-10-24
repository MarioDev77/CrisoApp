import { api } from "@/lib/api";
export const GET = api({ auth: ["cliente", "loja", "admin"] }, async ({ usuario }) => ({ sucesso: true, usuario }));
