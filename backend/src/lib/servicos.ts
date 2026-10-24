import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { TAXAS_PADRAO, type Taxas } from "./materiais";

export const num = (d: Prisma.Decimal | number | string | null | undefined) => (d == null ? 0 : Number(d));
export const arred = (n: number) => Math.round(n * 100) / 100;

export async function taxasVigentes(): Promise<Taxas> {
  const c = await prisma().configuracao.findUnique({ where: { chave: "taxas" } });
  const v = c?.valor as Partial<Taxas> | null;
  if (!v || typeof v !== "object") return TAXAS_PADRAO;
  return {
    papelao: Number(v.papelao) > 0 ? Number(v.papelao) : TAXAS_PADRAO.papelao,
    plastico: Number(v.plastico) > 0 ? Number(v.plastico) : TAXAS_PADRAO.plastico,
    aluminio: Number(v.aluminio) > 0 ? Number(v.aluminio) : TAXAS_PADRAO.aluminio,
    vidro: Number(v.vidro) > 0 ? Number(v.vidro) : TAXAS_PADRAO.vidro,
  };
}

export async function configQr(): Promise<{ expiracao_segundos: number; max_tentativas: number }> {
  const c = await prisma().configuracao.findUnique({ where: { chave: "qr" } });
  const v = (c?.valor ?? {}) as { expiracao_segundos?: number; max_tentativas?: number };
  return { expiracao_segundos: Number(v.expiracao_segundos) || 60, max_tentativas: Number(v.max_tentativas) || 5 };
}

type Db = Pick<ReturnType<typeof prisma>, "logAuditoria">;
export async function auditar(acao: string, detalhe: string, ip: string, idCliente?: number | null, db: Db = prisma()) {
  await db.logAuditoria.create({ data: { acao, detalhe: detalhe.slice(0, 2000), ip: ip.slice(0, 64), idCliente: idCliente ?? null } });
}

export const tz = () => env().APP_TIMEZONE;
