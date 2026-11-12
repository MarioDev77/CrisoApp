import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { mfaValidado, autenticar, exigir, type Perfil, type Principal } from "./auth";
import { HttpError } from "./errors";
import { mfaObrigatorio } from "./mfa";
import { limitar, type Regra } from "./rate-limit";
import { alertarIpNaoConfiavel, resolverIp } from "./client-ip";
import { log } from "./log";

const MAX_BODY = 10 * 1024;

type Chave = "ip" | "usuario" | "ip+email" | "email";
export type Opcoes<B, Q> = {
  /** false = pública. Lista = perfis permitidos. */
  auth: false | Perfil[];
  body?: ZodType<B>;
  query?: ZodType<Q>;
  limites?: (Regra & { por: Chave })[];
};
export type Ctx<B, Q, P> = { req: NextRequest; body: B; query: Q; params: P; usuario: Principal; ip: string; ipConfiavel: boolean };

const json = (status: number, corpo: unknown, headers?: HeadersInit) =>
  NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store", ...headers } });

async function lerCorpo(req: NextRequest): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "Corpo da requisição muito grande");
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) {
        await reader.cancel();
        throw new HttpError(413, "Corpo da requisição muito grande");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const txt = new TextDecoder().decode(Buffer.concat(chunks));
  if (!txt.trim()) return {};
  try {
    return JSON.parse(txt);
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

/** Fator do balde global usado quando o IP não é confiável: protege contra inundação sem punir um IP específico. */
export const FATOR_IP_DESCONHECIDO = 10;
/**
 * Regra por IP: com IP confiável vale como está. Sem IP confiável NÃO se pula silenciosamente (a proteção seria
 * falsa): usa-se um balde global com teto maior, e a rota emite alerta operacional. Regras por IP+e-mail são
 * desligadas nesse caso (viraria um balde por e-mail para o mundo todo: qualquer um bloquearia qualquer conta).
 */
export const regraParaIp = (l: Regra, ipConfiavel: boolean): Regra => (ipConfiavel ? l : { ...l, max: l.max * FATOR_IP_DESCONHECIDO });

export function api<B = unknown, Q = unknown, P = Record<string, string>>(
  opts: Opcoes<B, Q>,
  fn: (c: Ctx<B, Q, P>) => Promise<unknown | Response>,
) {
  return async (req: NextRequest, rota: { params: Promise<P> }): Promise<Response> => {
    const t0 = Date.now();
    const rid = crypto.randomUUID().slice(0, 8);
    let status = 500;
    try {
      const info = resolverIp(req.headers);
      const { ip, confiavel: ipConfiavel } = info;
      alertarIpNaoConfiavel(info);
      // 1) limite por IP antes de qualquer trabalho caro
      for (const l of opts.limites ?? []) {
        if (l.por === "ip") await limitar(regraParaIp(l, ipConfiavel), ip);
      }

      const usuario = opts.auth ? await autenticar(req) : (null as unknown as Principal);
      if (opts.auth) exigir(usuario, ...opts.auth);
      // Sessão sem MFA validado só alcança a configuração do segundo fator (e sair da conta).
      const rotaLivreSemMfa = /^\/api\/auth\/(?:mfa\/(?:setup|confirm)|logout)$/.test(req.nextUrl.pathname);
      if (usuario && mfaObrigatorio(usuario.tipo) && !mfaValidado(usuario) && !rotaLivreSemMfa) throw new HttpError(403, "Conclua a configuração do segundo fator antes de continuar.", { mfa_setup_required: true });

      let body = undefined as B;
      if (opts.body) {
        const bruto = await lerCorpo(req);
        body = opts.body.parse(bruto);
      } else if (req.method !== "GET" && req.method !== "HEAD") {
        await lerCorpo(req); // aplica o teto de tamanho mesmo sem schema
      }
      const query = opts.query ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams)) : (undefined as Q);

      for (const l of opts.limites ?? []) {
        if (l.por === "usuario" && usuario) await limitar(l, `${usuario.tipo}:${usuario.id}`);
        if (l.por === "ip+email" && ipConfiavel) {
          const email = String((body as { email?: string } | undefined)?.email ?? "").toLowerCase();
          await limitar(l, `${ip}|${email}`);
        }
        if (l.por === "email") {
          const email = String((body as { email?: string } | undefined)?.email ?? "").trim().toLowerCase();
          if (email) await limitar(l, email, true);
        }
      }

      const params = (await rota.params) ?? ({} as P);
      const out = await fn({ req, body, query, params, usuario, ip, ipConfiavel });
      if (out instanceof Response) {
        status = out.status;
        return out;
      }
      status = 200;
      return json(200, out);
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        const headers: Record<string, string> = {};
        if (e.status === 429 && typeof e.extra.retryAfter === "number") headers["Retry-After"] = String(e.extra.retryAfter);
        const { retryAfter: _r, ...extra } = e.extra;
        return json(e.status, { sucesso: false, mensagem: e.message, ...extra }, headers);
      }
      if (e instanceof ZodError) {
        status = 400;
        const primeira = e.issues[0];
        return json(400, { sucesso: false, mensagem: primeira?.message ?? "Dados inválidos", campo: primeira?.path.join(".") });
      }
      status = 500;
      log.error("erro_interno", { rid, rota: req.nextUrl.pathname, erro: e instanceof Error ? e.message : String(e) });
      return json(500, { sucesso: false, mensagem: "Erro interno", ref: rid });
    } finally {
      log.info("req", { rid, m: req.method, p: req.nextUrl.pathname, s: status, ms: Date.now() - t0 });
    }
  };
}
