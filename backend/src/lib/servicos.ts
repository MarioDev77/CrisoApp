import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { TAXAS_PADRAO, type Taxas } from "./materiais";
import { cifrar, mascararEmail, mascararTelefone } from "./crypto";

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

export type LimitesAntifraude = { credito_loja_dia: number; credito_cliente_dia: number; resgate_cliente_dia: number; carencia_horas: number };
const LIMITES_ANTIFRAUDE_PADRAO: LimitesAntifraude = { credito_loja_dia: 300, credito_cliente_dia: 150, resgate_cliente_dia: 100, carencia_horas: 24 };
export async function limitesAntifraude(): Promise<LimitesAntifraude> {
  const c = await prisma().configuracao.findUnique({ where: { chave: "limites_antifraude" } });
  const v = (c?.valor ?? {}) as Partial<LimitesAntifraude>;
  return Object.fromEntries(Object.entries(LIMITES_ANTIFRAUDE_PADRAO).map(([k, padrao]) => [k, Number.isFinite(Number(v[k as keyof LimitesAntifraude])) && Number(v[k as keyof LimitesAntifraude]) > 0 ? Number(v[k as keyof LimitesAntifraude]) : padrao])) as unknown as LimitesAntifraude;
}

type Db = Pick<ReturnType<typeof prisma>, "logAuditoria">;
export async function auditar(acao: string, detalhe: string, ip: string, idCliente?: number | null, db: Db = prisma()) {
  const seguro = detalhe
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (v) => mascararEmail(v))
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, (v) => mascararTelefone(v));
  const e = env();
  const ipEnc = e.DATA_ENCRYPTION_KEYS && e.BLIND_INDEX_KEY && ip && ip !== "desconhecido" ? cifrar(ip, "logs_auditoria.ip") : null;
  await db.logAuditoria.create({ data: { acao, detalhe: seguro.slice(0, 2000), ip: ip.slice(0, 64), ipEnc, idCliente: idCliente ?? null } });
}

export const tz = () => env().APP_TIMEZONE;
