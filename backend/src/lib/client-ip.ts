import net from "node:net";
import { timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { log } from "./log";

export const IP_DESCONHECIDO = "desconhecido";
export type IpInfo = { ip: string; confiavel: boolean; modo: string; motivo?: string };

/** Valida e normaliza: IPv4 puro; IPv4-mapeado vira IPv4; IPv6 vira o prefixo /64 (um atacante controla o /64 inteiro). */
export function normalizarIp(bruto: string): string | null {
  let v = bruto.trim();
  const colchete = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (colchete) v = colchete[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.replace(/:\d+$/, "");
  v = v.replace(/%.*$/, "");
  const tipo = net.isIP(v);
  if (tipo === 4) return v;
  if (tipo !== 6) return null;
  const mapeado = v.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapeado && net.isIP(mapeado[1]) === 4) return mapeado[1];
  let [cabeca, cauda] = v.toLowerCase().split("::");
  const g = (t?: string) => (t ? t.split(":").filter(Boolean) : []);
  let a = g(cabeca), b = g(cauda);
  if (a.join(":").includes(".") || b.join(":").includes(".")) return null; // IPv6 com IPv4 embutido fora do caso mapeado
  const falta = 8 - a.length - b.length;
  const todos = v.includes("::") ? [...a, ...Array(Math.max(falta, 0)).fill("0"), ...b] : a;
  if (todos.length !== 8) return null;
  return `${todos.slice(0, 4).map((x) => x.padStart(4, "0")).join(":")}::/64`;
}

/** O ORIGIN_SECRET é a prova de que a requisição passou pelo proxy (Vercel) e não veio direto ao backend. */
function origemVerificada(headers: Headers): boolean {
  const segredo = env().ORIGIN_SECRET;
  if (!segredo) return false;
  const a = Buffer.from(headers.get("x-origin-secret") ?? "");
  const b = Buffer.from(segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function resolverIp(headers: Headers): IpInfo {
  const e = env();
  const modo = e.TRUSTED_PROXY;
  const desconhecido = (motivo: string): IpInfo => ({ ip: IP_DESCONHECIDO, confiavel: false, modo, motivo });
  let bruto: string | null | undefined;
  switch (modo) {
    case "none": return desconhecido("TRUSTED_PROXY=none: nenhum cabeçalho é confiável");
    case "cloudflare": bruto = headers.get("cf-connecting-ip"); break;
    case "railway": bruto = headers.get("x-real-ip"); break; // a borda do Railway sobrescreve; é o IP de quem conectou
    case "hops": {
      const lista = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      bruto = lista[lista.length - e.TRUSTED_PROXY_HOPS];
      break;
    }
    case "vercel": {
      if (!origemVerificada(headers)) return desconhecido("ORIGIN_SECRET ausente ou inválido: cabeçalho de IP ignorado");
      bruto = (headers.get(e.CLIENT_IP_HEADER) ?? "").split(",")[0];
      break;
    }
  }
  if (!bruto) return desconhecido("cabeçalho de IP ausente");
  const ip = normalizarIp(bruto);
  return ip ? { ip, confiavel: true, modo } : desconhecido("cabeçalho de IP inválido");
}

/** Compatível com o uso antigo: só a string. */
export const clientIp = (headers: Headers): string => resolverIp(headers).ip;

let ultimoAlerta = 0;
/** Alerta operacional (1 por minuto por processo): a proteção por IP NÃO está efetiva e não deve ser dada como ativa. */
export function alertarIpNaoConfiavel(info: IpInfo, agora = Date.now()): void {
  if (info.confiavel || env().NODE_ENV !== "production" || agora - ultimoAlerta < 60_000) return;
  ultimoAlerta = agora;
  log.error("ip_nao_identificado", { modo: info.modo, motivo: info.motivo, efeito: "limites por IP usam balde global reduzido; limites por IP+e-mail desativados" });
}
export const _resetarAlerta = () => { ultimoAlerta = 0; };
