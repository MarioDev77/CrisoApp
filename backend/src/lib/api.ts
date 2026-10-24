import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { autenticar, exigir, type Perfil, type Principal } from "./auth";
import { HttpError } from "./errors";
import { limitar, type Regra } from "./rate-limit";
import { clientIp } from "./client-ip";
import { log } from "./log";

const MAX_BODY = 10 * 1024;

type Chave = "ip" | "usuario" | "ip+email";
export type Opcoes<B, Q> = {
  /** false = pública. Lista = perfis permitidos. */
  auth: false | Perfil[];
  body?: ZodType<B>;
  query?: ZodType<Q>;
  limites?: (Regra & { por: Chave })[];
};
export type Ctx<B, Q, P> = { req: NextRequest; body: B; query: Q; params: P; usuario: Principal; ip: string };

const json = (status: number, corpo: unknown, headers?: HeadersInit) =>
  NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store", ...headers } });

async function lerCorpo(req: NextRequest): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new HttpError(413, "Corpo da requisição muito grande");
  const txt = await req.text();
  if (Buffer.byteLength(txt) > MAX_BODY) throw new HttpError(413, "Corpo da requisição muito grande");
  if (!txt.trim()) return {};
  try {
    return JSON.parse(txt);
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

export function api<B = unknown, Q = unknown, P = Record<string, string>>(
  opts: Opcoes<B, Q>,
  fn: (c: Ctx<B, Q, P>) => Promise<unknown | Response>,
) {
  return async (req: NextRequest, rota: { params: Promise<P> }): Promise<Response> => {
    const t0 = Date.now();
    const rid = crypto.randomUUID().slice(0, 8);
    let status = 500;
    try {
      const ip = clientIp(req.headers);
      // 1) limite por IP antes de qualquer trabalho caro
      for (const l of opts.limites ?? []) if (l.por === "ip") await limitar(l, ip);

      const usuario = opts.auth ? await autenticar(req) : (null as unknown as Principal);
      if (opts.auth) exigir(usuario, ...opts.auth);

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
        if (l.por === "ip+email") {
          const email = String((body as { email?: string } | undefined)?.email ?? "").toLowerCase();
          await limitar(l, `${ip}|${email}`);
        }
      }

      const params = (await rota.params) ?? ({} as P);
      const out = await fn({ req, body, query, params, usuario, ip });
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
