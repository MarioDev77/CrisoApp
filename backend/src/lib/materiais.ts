import { z } from "zod";
import { env } from "./env";

export const MATERIAIS = ["papelao", "plastico", "aluminio", "vidro"] as const;
export type Material = (typeof MATERIAIS)[number];
export type Taxas = Record<Material, number>;
export const KG_POR_UNIDADE = 0.05; // regra original: 0,05 kg por unidade, qualquer material
export const TAXAS_PADRAO: Taxas = { papelao: 7, plastico: 10, aluminio: 6, vidro: 4 };
const CREDITO_POR_BLOCO = 0.25;

export const materiaisSchema = () =>
  z
    .object(Object.fromEntries(MATERIAIS.map((m) => [m, z.coerce.number().int().min(0).max(env().QR_MAX_UNIDADES_POR_MATERIAL).default(0)])) as Record<Material, z.ZodDefault<z.ZodNumber>>)
    .partial()
    .transform((o) => Object.fromEntries(MATERIAIS.map((m) => [m, o[m] ?? 0])) as Record<Material, number>);

export function calcularCreditos(mat: Record<Material, number>, taxas: Taxas): number {
  let total = 0;
  for (const m of MATERIAIS) total += Math.floor(mat[m] / Math.max(1, taxas[m])) * CREDITO_POR_BLOCO;
  return Math.round(total * 100) / 100;
}
export function calcularKg(mat: Record<Material, number>): number {
  const unidades = MATERIAIS.reduce((a, m) => a + mat[m], 0);
  return Math.round(unidades * KG_POR_UNIDADE * 100) / 100;
}
export function descricao(mat: Record<Material, number>): string {
  const p = MATERIAIS.filter((m) => mat[m] > 0).map((m) => `${m}: ${mat[m]}`);
  return p.length ? p.join(", ") : "-";
}
