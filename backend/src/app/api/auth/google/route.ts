import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { log } from "@/lib/log";
import { respostaComSessao } from "@/lib/sessao";

const body = z.object({ credential: z.string({ error: "Token do Google não informado." }).min(10, "Token do Google não informado.").max(5000) });
let client: OAuth2Client | null = null;

export const POST = api(
  { auth: false, body, limites: [{ nome: "google-ip", por: "ip", max: 30, janelaSeg: 900 }] },
  async ({ body }) => {
    const id = env().GOOGLE_CLIENT_ID;
    if (!id) throw new HttpError(503, "Login com Google indisponível no momento.");
    client ??= new OAuth2Client(id);
    let p;
    try {
      p = (await client.verifyIdToken({ idToken: body.credential, audience: id })).getPayload();
    } catch (e) {
      log.warn("google_token_invalido", { erro: e instanceof Error ? e.message : String(e) });
      throw new HttpError(401, "Não foi possível validar sua conta Google.");
    }
    if (!p?.email || !p.sub) throw new HttpError(401, "Não foi possível validar sua conta Google.");
    if (!p.email_verified) throw new HttpError(401, "Seu e-mail Google ainda não foi verificado.");
    const email = p.email.trim().toLowerCase();
    const foto = p.picture ?? null;

    const existente = await prisma().usuario.findUnique({ where: { email } });
    let u;
    if (existente) {
      if (existente.deletadoEm || existente.status !== "ativo") throw new HttpError(403, "Conta bloqueada ou inativa");
      // Não vincula automaticamente se já houver OUTRO google_id associado
      if (existente.googleId && existente.googleId !== p.sub) throw new HttpError(403, "Conta já vinculada a outro perfil Google");
      u = await prisma().usuario.update({
        where: { id: existente.id },
        data: { provider: "google", googleId: p.sub, foto, emailVerificado: true, ultimoLogin: new Date() },
      });
    } else {
      u = await prisma().usuario.create({
        data: { nome: (p.name || email.split("@")[0]).slice(0, 120), email, senha: null, tipo: "cliente", status: "ativo", provider: "google", googleId: p.sub, foto, emailVerificado: true, ultimoLogin: new Date() },
      });
    }
    return respostaComSessao(
      { sucesso: true, perfil: { id: u.id, nome: u.nome, email: u.email, tipo: u.tipo, foto } },
      { id: u.id, tipo: u.tipo, versao: u.versaoSessao },
    );
  },
);
