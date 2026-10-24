import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { log } from "@/lib/log";
import { respostaComSessao } from "@/lib/sessao";
import { buscarUsuarioPorEmail, buscarUsuarioPorGoogleId, camposEmailUsuario, emailDoUsuario, hashGoogleId } from "@/lib/pii";
import { dadosVinculoGoogle } from "@/lib/google-link";
import { exigirMfaNoLogin } from "@/lib/mfa-codigos";
import { mfaObrigatorio } from "@/lib/mfa";

const body = z.object({ credential: z.string({ error: "Token do Google não informado." }).min(10, "Token do Google não informado.").max(5000), codigo_mfa: z.string().trim().max(32).optional() });
let client: OAuth2Client | null = null;

export const POST = api(
  { auth: false, body, limites: [{ nome: "google-ip", por: "ip", max: 30, janelaSeg: 900 }] },
  async ({ body }) => {
    if (!env().GOOGLE_LOGIN_ATIVO) throw new HttpError(503, "Login com Google indisponível no momento.");
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

    const [existente, contaGoogle] = await Promise.all([
      buscarUsuarioPorEmail(prisma(), email),
      buscarUsuarioPorGoogleId(prisma(), p.sub),
    ]);
    if (contaGoogle && contaGoogle.email !== email && contaGoogle.emailHash !== (existente?.emailHash ?? null)) throw new HttpError(403, "Conta Google já vinculada a outro perfil.");
    let u;
    let m = { mfa: false, setup: false };
    if (existente) {
      if (existente.deletadoEm || existente.status !== "ativo") throw new HttpError(403, "Conta bloqueada ou inativa");
      if (existente.tipo === "admin") throw new HttpError(403, "Administradores devem entrar com senha e código MFA.");
      // Não vincula automaticamente se já houver OUTRO google_id associado
      if (existente.googleId && existente.googleId !== p.sub) throw new HttpError(403, "Conta já vinculada a outro perfil Google");
      m = await exigirMfaNoLogin({ tipo: "usuario", id: existente.id }, existente.tipo, body.codigo_mfa ?? "");
      u = await prisma().usuario.update({
        where: { id: existente.id },
        data: { ...dadosVinculoGoogle(existente, p.sub, foto), ...camposEmailUsuario(email), googleIdHash: hashGoogleId(p.sub) },
      });
    } else {
      u = await prisma().usuario.create({
        data: { nome: (p.name || email.split("@")[0]).slice(0, 120), ...camposEmailUsuario(email), senha: null, tipo: "cliente", status: "ativo", provider: "google", googleId: p.sub, googleIdHash: hashGoogleId(p.sub), foto, emailVerificado: true, ultimoLogin: new Date() },
      });
      m = { mfa: false, setup: mfaObrigatorio("cliente") };
    }
    return respostaComSessao(
      { sucesso: true, perfil: { id: u.id, nome: u.nome, email: emailDoUsuario(u), tipo: u.tipo, foto }, ...(m.setup ? { mfa_setup_required: true } : {}) },
      { id: u.id, tipo: u.tipo, versao: u.versaoSessao, mfa: m.mfa },
    );
  },
);
