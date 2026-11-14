// Integração de ROTAS REAIS (api() + handlers + Prisma real) contra um PostgreSQL DESCARTÁVEL.
// Roda só com TEST_DATABASE_URL (migrations aplicadas). Apaga as tabelas de negócio: NUNCA aponte para banco real.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import pg from "pg";

const URL_TESTE = process.env.TEST_DATABASE_URL; // dono do banco de teste (limpeza e ajustes de fixture)
const URL_APP = process.env.TEST_APP_DATABASE_URL ?? URL_TESTE; // o que o app usa (pode ser o papel limitado criso_app)
let dono: pg.Pool;
const ctx = { params: Promise.resolve({}) };
const k = () => crypto.randomBytes(32).toString("base64");
const SENHA = "Senha#12345";

type Rotas = Awaited<ReturnType<typeof carregar>>;
async function carregar() {
  vi.resetModules();
  const m = async <T,>(p: string) => (await import(/* @vite-ignore */ p)) as T;
  return {
    prisma: (await import("../../src/lib/db")).prisma,
    auth: await import("../../src/lib/auth"),
    pii: await import("../../src/lib/pii"),
    login: await import("../../src/app/api/auth/login/route"),
    gerar: await import("../../src/app/api/qr/gerar/route"),
    validar: await import("../../src/app/api/qr/validar/route"),
    confirmar: await import("../../src/app/api/qr/confirmar/route"),
    perfil: await import("../../src/app/api/cliente/perfil/route"),
    resgatar: await import("../../src/app/api/cliente/resgatar/route"),
    taxas: await import("../../src/app/api/admin/configuracoes/taxas/route"),
    bloquear: await import("../../src/app/api/admin/usuarios/[id]/bloquear/route"),
    mfaSetup: await import("../../src/app/api/auth/mfa/setup/route"),
    mfaConfirm: await import("../../src/app/api/auth/mfa/confirm/route"),
    proxy: await import("../../src/proxy"),
    dispositivo: await import("../../src/lib/dispositivo"),
    _: m,
  };
}

let R: Rotas;
const req = (path: string, o: { method?: string; body?: unknown; cookie?: string; ip?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: o.method ?? "POST",
    headers: { "content-type": "application/json", "x-real-ip": o.ip ?? "203.0.113.1", ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any>, headers: r.headers });
const setCookies = (r: Response) => Object.fromEntries(r.headers.getSetCookie().map((c) => { const [kv] = c.split(";"); const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));

async function sessao(tipo: "cliente" | "loja" | "admin", id: number, mfa = false) {
  const conta = tipo === "loja" ? await R.prisma().loja.findUniqueOrThrow({ where: { id } }) : await R.prisma().usuario.findUniqueOrThrow({ where: { id } });
  return `crisoverde_session=${await R.auth.emitirSessao({ id, tipo, versao: conta.versaoSessao, mfa })}`;
}
async function cliente(nome: string, over: Record<string, unknown> = {}) {
  const email = `${nome}@teste.local`;
  return R.prisma().usuario.create({ data: { nome: `Cliente ${nome}`, ...R.pii.camposEmailUsuario(email), ...R.pii.camposTelefoneUsuario("71999990000"), senha: await R.auth.hashSenha(SENHA), tipo: "cliente", status: "ativo", emailVerificado: true, ...over } as never });
}
async function admin(nome: string) {
  const email = `${nome}@teste.local`;
  return R.prisma().usuario.create({ data: { nome: `Admin ${nome}`, ...R.pii.camposEmailUsuario(email), ...R.pii.camposTelefoneUsuario("71999990001"), senha: await R.auth.hashSenha(SENHA), tipo: "admin", status: "ativo", emailVerificado: true } as never });
}
async function loja(nome: string) {
  const email = `${nome}@loja.local`;
  return R.prisma().loja.create({ data: { nome: `Loja ${nome}`, ...R.pii.camposResponsavelLoja("Resp"), ...R.pii.camposEmailLoja(email), ...R.pii.camposTelefoneLoja("71988880000"), ...R.pii.camposEnderecoLoja("Rua A"), senha: await R.auth.hashSenha(SENHA), status: "ativo" } as never });
}
const emailDe = (nome: string) => `${nome}@teste.local`;
const entrar = (nome: string, senha = SENHA, o: { ip?: string; cookie?: string } = {}) => R.login.POST(req("/api/auth/login", { body: { email: emailDe(nome), senha }, ...o }), ctx);
const credito = { papelao: 70, plastico: 0, aluminio: 0, vidro: 0 }; // 70/7 = 10 blocos x 0,25 = 2,50
const gerarCredito = async (lojaId: number, idCliente?: number) => json(await R.gerar.POST(req("/api/qr/gerar", { cookie: await sessao("loja", lojaId), body: { tipo: "credito", materiais: credito, ...(idCliente ? { id_cliente: idCliente } : {}) } }), ctx));
const confirmar = async (clienteId: number, token: string) => json(await R.confirmar.POST(req("/api/qr/confirmar", { cookie: await sessao("cliente", clienteId), body: { token } }), ctx));
const auditoria = async (acao: string) => R.prisma().logAuditoria.findMany({ where: { acao }, orderBy: { id: "asc" } });

function totp(segredo: string, agora = Date.now()) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, acc = 0; const out: number[] = [];
  for (const ch of segredo) { acc = (acc << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(agora / 30000)));
  const d = crypto.createHmac("sha1", Buffer.from(out)).update(msg).digest(); const o = d[d.length - 1] & 15;
  return String((((d[o] & 127) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) % 1_000_000).padStart(6, "0");
}

describe.skipIf(!URL_TESTE)("integração das rotas (banco real)", () => {
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 }); // bcrypt real: cada login leva ~300 ms
  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: URL_APP, SESSION_SECRET: "s".repeat(48), OTP_PEPPER: "o".repeat(40), QR_SIGNING_SECRET: "q".repeat(40),
      DATA_ENCRYPTION_KEYS: `k1:${k()}`, BLIND_INDEX_KEY: k(), TRUSTED_PROXY: "railway",
    });
    delete process.env.QR_CREDITO_EXIGE_CLIENTE; delete process.env.EXIGIR_EMAIL_VERIFICADO;
  });
  afterAll(async () => { await R?.prisma().$disconnect(); await dono?.end(); });
  beforeEach(async () => {
    delete process.env.QR_CREDITO_EXIGE_CLIENTE; delete process.env.EXIGIR_EMAIL_VERIFICADO;
    R = await carregar();
    dono ??= new pg.Pool({ connectionString: URL_TESTE, max: 2 });
    await dono.query("TRUNCATE usuarios, lojas, configuracoes, rate_limits, logs_auditoria, mfa_contas RESTART IDENTITY CASCADE");
  });

  describe("autenticação, autorização, IDOR e mass assignment", () => {
    it("sem sessão → 401; perfil errado → 403; sessão de versão antiga → 401", async () => {
      const c = await cliente("ana");
      expect((await json(await R.perfil.GET(req("/api/cliente/perfil", { method: "GET" }), ctx))).status).toBe(401);
      const l = await loja("l1");
      expect((await json(await R.perfil.GET(req("/api/cliente/perfil", { method: "GET", cookie: await sessao("loja", l.id) }), ctx))).status).toBe(403);
      expect((await json(await R.taxas.POST(req("/api/admin/configuracoes/taxas", { cookie: await sessao("cliente", c.id), body: { papelao: 9 } }), ctx))).status).toBe(403);
      const velha = await sessao("cliente", c.id);
      await R.prisma().usuario.update({ where: { id: c.id }, data: { versaoSessao: { increment: 1 } } });
      expect((await json(await R.perfil.GET(req("/api/cliente/perfil", { method: "GET", cookie: velha }), ctx))).status).toBe(401);
    });

    it("IDOR: o perfil devolvido é sempre o da sessão, nunca de outro cliente", async () => {
      const a = await cliente("ana"), b = await cliente("bia");
      const ra = await json(await R.perfil.GET(req("/api/cliente/perfil", { method: "GET", cookie: await sessao("cliente", a.id) }), ctx));
      const rb = await json(await R.perfil.GET(req("/api/cliente/perfil", { method: "GET", cookie: await sessao("cliente", b.id) }), ctx));
      expect(ra.body.nome).toBe("Cliente ana"); expect(rb.body.nome).toBe("Cliente bia");
      expect(JSON.stringify(ra.body)).not.toContain("bia");
    });

    it("mass assignment: tipo, saldo, status e e-mail verificado enviados no corpo são ignorados", async () => {
      const c = await cliente("ana", { emailVerificado: false });
      const r = await json(await R.perfil.PUT(req("/api/cliente/perfil", { method: "PUT", cookie: await sessao("cliente", c.id), body: { nome: "Ana Maria", email: emailDe("ana"), telefone: "71999990000", tipo: "admin", saldo: 9999, status: "bloqueado", emailVerificado: true, versaoSessao: 77 } }), ctx));
      expect(r.status).toBe(200);
      const depois = await R.prisma().usuario.findUniqueOrThrow({ where: { id: c.id } });
      expect(depois).toMatchObject({ tipo: "cliente", status: "ativo", emailVerificado: false, versaoSessao: 0 });
      expect(Number(depois.saldo)).toBe(0);
    });

    it("injeção de SQL em e-mail e token: nunca vira erro 500 nem acesso", async () => {
      await cliente("ana");
      const a = await json(await R.login.POST(req("/api/auth/login", { body: { email: "' OR 1=1 --", senha: "x" } }), ctx));
      expect(a.status).toBe(400);
      const b = await json(await R.login.POST(req("/api/auth/login", { body: { email: "x@y.com' OR '1'='1", senha: "x" } }), ctx));
      expect([400, 401]).toContain(b.status);
      const c = await cliente("bia");
      const v = await json(await R.validar.POST(req("/api/qr/validar", { cookie: await sessao("cliente", c.id), body: { token: "x' OR '1'='1" } }), ctx));
      expect(v.status).toBe(404);
    });
  });

  describe("CSRF (proxy)", () => {
    const post = (h: Record<string, string>) => R.proxy.proxy(new NextRequest("http://localhost/api/qr/gerar", { method: "POST", headers: { host: "localhost", ...h } }));
    it("origem estranha ou cross-site é barrada; mesma origem passa; GET não é afetado", async () => {
      expect((await post({ origin: "https://evil.example" })).status).toBe(403);
      expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect((await post({ origin: "http://localhost", "sec-fetch-site": "same-origin" })).status).toBe(200);
      const get = await R.proxy.proxy(new NextRequest("http://localhost/api/qr/gerar", { method: "GET", headers: { origin: "https://evil.example", host: "localhost" } }));
      expect(get.status).toBe(200);
    });
    it("a CSP não libera accounts.google.com enquanto o login Google está desativado", async () => {
      const r = await post({ origin: "http://localhost" });
      expect(r.headers.get("content-security-policy")).not.toContain("accounts.google.com");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
    });
  });

  describe("login sob ataque (rotas reais)", () => {
    it("8 erros do mesmo IP bloqueiam esse IP com Retry-After; a vítima em outro IP entra normalmente e recebe o cookie de dispositivo", async () => {
      await cliente("vitima");
      for (let i = 0; i < 8; i++) expect((await entrar("vitima", "errada", { ip: "198.51.100.66" })).status).toBe(401);
      const bloqueado = await entrar("vitima", "errada", { ip: "198.51.100.66" });
      expect(bloqueado.status).toBe(429); expect(Number(bloqueado.headers.get("retry-after"))).toBeGreaterThan(0);
      const ok = await entrar("vitima", SENHA, { ip: "203.0.113.10" });
      expect(ok.status).toBe(200);
      expect(Object.keys(setCookies(ok))).toContain("crisoverde_dispositivo");
    });

    it("acertar depois de errar devolve o orçamento: o contador de falhas volta a zero", async () => {
      await cliente("ana");
      for (let i = 0; i < 5; i++) await entrar("ana", "errada", { ip: "203.0.113.20" });
      expect((await entrar("ana", SENHA, { ip: "203.0.113.20" })).status).toBe(200);
      for (let i = 0; i < 8; i++) expect((await entrar("ana", "errada", { ip: "203.0.113.20" })).status).toBe(401);
    });

    it("muitos IPs contra a mesma conta: estranho 429; dono com cookie de dispositivo ainda entra", async () => {
      await cliente("alvo");
      const primeiro = await entrar("alvo", SENHA, { ip: "203.0.113.30" });
      const dispositivo = `crisoverde_dispositivo=${setCookies(primeiro)["crisoverde_dispositivo"]}`;
      for (let i = 0; i < 16; i++) await entrar("alvo", "errada", { ip: `198.51.100.${i + 1}` });
      const estranho = await entrar("alvo", SENHA, { ip: "198.51.100.200" });
      expect(estranho.status).toBe(429);
      const dono = await entrar("alvo", SENHA, { ip: "203.0.113.31", cookie: dispositivo });
      expect(dono.status).toBe(200);
    });

    it("senha correta com conta bloqueada não gasta tentativa (403 devolve a reserva)", async () => {
      await cliente("bloq", { status: "bloqueado" });
      for (let i = 0; i < 12; i++) expect((await entrar("bloq", SENHA, { ip: "203.0.113.40" })).status).toBe(403);
    });
  });

  describe("QR de crédito preso ao cliente (e integridade financeira)", () => {
    it("fluxo feliz: crédito exato, uma transação, QR usado, saldo certo", async () => {
      const l = await loja("l1"), a = await cliente("ana");
      const g = await gerarCredito(l.id, a.id);
      expect(g.status).toBe(200);
      const c = await confirmar(a.id, g.body.token);
      expect(c.status).toBe(200); expect(c.body.novo_saldo).toBe(2.5);
      const u = await R.prisma().usuario.findUniqueOrThrow({ where: { id: a.id } });
      expect(Number(u.saldo)).toBe(2.5); expect(Number(u.totalGanho)).toBe(2.5);
      expect(await R.prisma().transacao.count({ where: { idCliente: a.id } })).toBe(1);
      expect((await R.prisma().qrCode.findUniqueOrThrow({ where: { token: g.body.token } })).status).toBe("usado");
    });

    it("outro cliente não lê nem confirma o QR reservado; fica o rastro e nada é creditado a ele", async () => {
      const l = await loja("l1"), a = await cliente("ana"), b = await cliente("bia");
      const g = await gerarCredito(l.id, a.id);
      const v = await json(await R.validar.POST(req("/api/qr/validar", { cookie: await sessao("cliente", b.id), body: { token: g.body.token } }), ctx));
      expect(v.status).toBe(403);
      const c = await confirmar(b.id, g.body.token);
      expect(c.status).toBe(403); expect(c.body.mensagem).toMatch(/outro cliente/);
      const bb = await R.prisma().usuario.findUniqueOrThrow({ where: { id: b.id } });
      expect(Number(bb.saldo)).toBe(0);
      expect((await R.prisma().qrCode.findUniqueOrThrow({ where: { token: g.body.token } })).status).toBe("ativo");
      expect((await auditoria("qr_outro_cliente")).length).toBe(2);
      expect((await confirmar(a.id, g.body.token)).status).toBe(200); // o dono ainda consegue
    });

    it("corrida: A e B confirmam ao mesmo tempo o QR de A; 5 confirmações de A em paralelo creditam uma única vez", async () => {
      const l = await loja("l1"), a = await cliente("ana"), b = await cliente("bia");
      const g = await gerarCredito(l.id, a.id);
      const r = await Promise.all([confirmar(b.id, g.body.token), ...Array.from({ length: 5 }, () => confirmar(a.id, g.body.token))]);
      expect(r[0].status).toBe(403);
      expect(r.slice(1).filter((x) => x.status === 200).length).toBe(1);
      const u = await R.prisma().usuario.findUniqueOrThrow({ where: { id: a.id } });
      expect(Number(u.saldo)).toBe(2.5);
      expect(await R.prisma().transacao.count({ where: { idCliente: a.id } })).toBe(1);
      expect(Number((await R.prisma().usuario.findUniqueOrThrow({ where: { id: b.id } })).saldo)).toBe(0);
    });

    it("QR sem cliente identificado continua valendo (compatível); com QR_CREDITO_EXIGE_CLIENTE=true a loja precisa identificar", async () => {
      const l = await loja("l1"), a = await cliente("ana");
      const livre = await gerarCredito(l.id);
      expect(livre.status).toBe(200);
      expect((await confirmar(a.id, livre.body.token)).status).toBe(200);
      process.env.QR_CREDITO_EXIGE_CLIENTE = "true"; R = await carregar();
      const barrado = await gerarCredito(l.id);
      expect(barrado.status).toBe(400); expect(barrado.body.mensagem).toMatch(/Identifique o cliente/);
      expect((await gerarCredito(l.id, a.id)).status).toBe(200);
    });

    it("a loja não consegue prender o QR a cliente inexistente, bloqueado ou que não é cliente", async () => {
      const l = await loja("l1"), bloq = await cliente("bloq", { status: "bloqueado" }), adm = await admin("adm");
      for (const id of [9999, bloq.id, adm.id]) expect((await gerarCredito(l.id, id)).status).toBe(400);
    });

    it("valor do crédito vem do servidor: tentar mandar `valor` no corpo não muda o que é creditado", async () => {
      const l = await loja("l1"), a = await cliente("ana");
      const r = await json(await R.gerar.POST(req("/api/qr/gerar", { cookie: await sessao("loja", l.id), body: { tipo: "credito", materiais: credito, valor: 9999, id_cliente: a.id } }), ctx));
      const c = await confirmar(a.id, r.body.token);
      expect(c.body.novo_saldo).toBe(2.5);
    });
  });

  describe("e-mail verificado (ativação gradual por EXIGIR_EMAIL_VERIFICADO)", () => {
    it("desligado: cliente com e-mail não confirmado continua operando (ninguém é bloqueado)", async () => {
      const l = await loja("l1"), a = await cliente("ana", { emailVerificado: false });
      const g = await gerarCredito(l.id, a.id);
      expect((await confirmar(a.id, g.body.token)).status).toBe(200);
    });
    it("ligado: confirmar QR e resgatar exigem e-mail confirmado; confirmado passa", async () => {
      process.env.EXIGIR_EMAIL_VERIFICADO = "true"; R = await carregar();
      const l = await loja("l1"), naoVer = await cliente("ana", { emailVerificado: false, saldo: "50" }), ver = await cliente("bia", { saldo: "50" });
      const g = await gerarCredito(l.id, naoVer.id);
      const c = await confirmar(naoVer.id, g.body.token);
      expect(c.status).toBe(403); expect(c.body.email_nao_verificado).toBe(true);
      const res = await json(await R.resgatar.POST(req("/api/cliente/resgatar", { cookie: await sessao("cliente", naoVer.id), body: { valor: 10, forma: "pix" } }), ctx));
      expect(res.status).toBe(403); expect(res.body.email_nao_verificado).toBe(true);
      expect(Number((await R.prisma().usuario.findUniqueOrThrow({ where: { id: naoVer.id } })).saldo)).toBe(50);
      const g2 = await gerarCredito(l.id, ver.id);
      expect((await confirmar(ver.id, g2.body.token)).status).toBe(200);
      const ok = await json(await R.resgatar.POST(req("/api/cliente/resgatar", { cookie: await sessao("cliente", ver.id), body: { valor: 10, forma: "pix" } }), ctx));
      expect(ok.body.email_nao_verificado).toBeUndefined();
    });
  });

  describe("auditoria administrativa com antes → depois", () => {
    it("alterar taxas grava valor anterior e posterior, só do que mudou, na mesma transação", async () => {
      const adm = await admin("adm"); const cookie = await sessao("admin", adm.id, true);
      const post = (b: unknown) => R.taxas.POST(req("/api/admin/configuracoes/taxas", { cookie, body: b }), ctx);
      expect((await post({ papelao: 7, plastico: 10, aluminio: 6, vidro: 4 })).status).toBe(200);
      expect((await post({ papelao: 9, plastico: 10, aluminio: 6, vidro: 5 })).status).toBe(200);
      const logs = await auditoria("admin_alterou_taxas");
      expect(logs.length).toBe(2);
      expect(logs[1].detalhe).toContain("papelao: 7 → 9"); expect(logs[1].detalhe).toContain("vidro: 4 → 5");
      expect(logs[1].detalhe).not.toContain("plastico");
      expect(logs[1].idCliente).toBe(adm.id);
    });
    it("bloquear usuário registra status anterior → novo e encerra as sessões dele", async () => {
      const adm = await admin("adm"), c = await cliente("ana");
      const antiga = await sessao("cliente", c.id);
      const r = await R.bloquear.POST(req(`/api/admin/usuarios/${c.id}/bloquear`, { cookie: await sessao("admin", adm.id, true) }), { params: Promise.resolve({ id: String(c.id) }) });
      expect(r.status).toBe(200);
      expect((await auditoria("admin_bloqueou_usuario"))[0].detalhe).toContain("status: ativo → bloqueado");
      expect((await json(await R.perfil.GET(req("/api/cliente/perfil", { method: "GET", cookie: antiga }), ctx))).status).toBe(401);
    });
    it("cliente comum não consegue chamar rota administrativa (autorização)", async () => {
      const c = await cliente("ana"), alvo = await cliente("bia");
      const r = await R.bloquear.POST(req(`/api/admin/usuarios/${alvo.id}/bloquear`, { cookie: await sessao("cliente", c.id) }), { params: Promise.resolve({ id: String(alvo.id) }) });
      expect(r.status).toBe(403);
      expect((await R.prisma().usuario.findUniqueOrThrow({ where: { id: alvo.id } })).status).toBe("ativo");
    });
  });

  describe("cadastro do autenticador (MFA) do administrador", () => {
    const setup = (cookie: string, body: unknown = {}) => R.mfaSetup.POST(req("/api/auth/mfa/setup", { cookie, body }), ctx);
    const confirm = (cookie: string, codigo: string) => R.mfaConfirm.POST(req("/api/auth/mfa/confirm", { cookie, body: { codigo } }), ctx);

    it("ativar encerra as OUTRAS sessões, deixa rastro e a sessão que ativou segue válida com MFA", async () => {
      const adm = await admin("adm");
      const login1 = await entrar("adm"); expect(login1.status).toBe(200);
      const s1 = `crisoverde_session=${setCookies(login1)["crisoverde_session"]}`;
      const login2 = await entrar("adm", SENHA, { ip: "203.0.113.50" });
      const s2 = `crisoverde_session=${setCookies(login2)["crisoverde_session"]}`; // "invasor" com a senha, em outra sessão
      const sup = await json(await setup(s1)); expect(sup.status).toBe(200);
      const ok = await confirm(s1, totp(sup.body.secret));
      expect(ok.status).toBe(200);
      const nova = `crisoverde_session=${setCookies(ok)["crisoverde_session"]}`;
      expect((await json(await R.perfil.GET(req("/api/cliente/perfil", { method: "GET", cookie: s2 }), ctx))).status).toBe(401); // sessão antiga morta
      expect((await json(await R.taxas.GET(req("/api/admin/configuracoes/taxas", { method: "GET", cookie: nova }), ctx))).status).toBe(200); // a nova funciona
      expect((await auditoria("mfa_setup_iniciado")).length).toBe(1);
      expect((await auditoria("mfa_ativado")).length).toBe(1);
      expect((await R.prisma().usuario.findUniqueOrThrow({ where: { id: adm.id } })).versaoSessao).toBeGreaterThan(0);
    });

    it("segredo pendente expira em 15 min (nem a chave copiada serve, nem o código)", async () => {
      await admin("adm");
      const s1 = `crisoverde_session=${setCookies(await entrar("adm"))["crisoverde_session"]}`;
      const sup = await json(await setup(s1));
      await dono.query("UPDATE mfa_contas SET atualizado_em = now() - interval '20 minutes'");
      const c = await json(await confirm(s1, totp(sup.body.secret)));
      expect(c.status).toBe(409);
      const outro = await json(await setup(s1)); // iniciar de novo gera um segredo NOVO
      expect(outro.body.secret).not.toBe(sup.body.secret);
      expect((await confirm(s1, totp(outro.body.secret))).status).toBe(200);
    });

    it("quem já tem MFA ativo não consegue refazer o setup por cima (409) e código errado é recusado", async () => {
      await admin("adm");
      const s1 = `crisoverde_session=${setCookies(await entrar("adm"))["crisoverde_session"]}`;
      const sup = await json(await setup(s1));
      expect((await confirm(s1, "000000")).status).toBe(400);
      const ok = await confirm(s1, totp(sup.body.secret));
      const nova = `crisoverde_session=${setCookies(ok)["crisoverde_session"]}`;
      expect((await setup(nova, { regenerar: true })).status).toBe(409);
    });
  });
});
