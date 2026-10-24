import { email } from "./schemas";

export function filtroBuscaCliente(busca: string) {
  const emailExato = email.safeParse(busca.trim());
  if (emailExato.success) return { email: emailExato.data };
  if (busca.includes("@") || busca.trim().length < 3) return null;
  return { nome: { contains: busca.trim(), mode: "insensitive" as const } };
}

export const resumoClienteBusca = (cliente: { id: number; nome: string }) => ({ id: cliente.id, nome: cliente.nome });
