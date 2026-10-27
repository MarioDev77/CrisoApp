import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { carteiraDoCliente } from "@/lib/carteira";
import { limitesAntifraude } from "@/lib/servicos";

export const GET = api({ auth: ["cliente"] }, async ({ usuario }) => {
  const limites = await limitesAntifraude();
  return carteiraDoCliente(prisma(), usuario.id, limites.carencia_horas);
});
