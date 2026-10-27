import { api } from "@/lib/api";
import { calcularImpacto, impactoQuery } from "@/lib/impacto";

/** Indicadores agregados no banco; só administradores; sem dados pessoais na resposta. */
export const GET = api({ auth: ["admin"], query: impactoQuery, limites: [{ nome: "admin-impacto", por: "usuario", max: 60, janelaSeg: 60 }] }, async ({ query }) => ({ sucesso: true, ...(await calcularImpacto(query)) }));
