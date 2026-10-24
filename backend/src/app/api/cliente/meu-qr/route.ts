import { api } from "@/lib/api";
import { gerarIdentificadorCliente } from "@/lib/auth";
export const GET = api({ auth: ["cliente"] }, async ({ usuario }) => ({
  sucesso: true, qr_data: gerarIdentificadorCliente(usuario.id), validade_seg: 90,
}));
