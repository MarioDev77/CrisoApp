// Testes contra PostgreSQL REAL (migrations aplicadas). Rodam quando TEST_DATABASE_URL está definida
// (ex.: postgresql://criso:teste@localhost:5432/criso_test) e são pulados caso contrário. Use só banco descartável.
// "Instâncias" = pools independentes (conexões distintas), cada uma no papel de um processo do backend.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const URL_TESTE = process.env.TEST_DATABASE_URL;
const pools: pg.Pool[] = [];
let rr = 0;
const consulta = (strings: TemplateStringsArray, ...v: unknown[]) => ({ texto: strings.reduce((a, s, i) => a + s + (i < v.length ? `$${i + 1}` : ""), ""), v });
const db = {
  $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => { const q = consulta(s, ...v); return (await pools[rr++ % pools.length].query(q.texto, q.v)).rows; },
  $executeRaw: async (s: TemplateStringsArray, ...v: unknown[]) => { const q = consulta(s, ...v); return (await pools[rr++ % pools.length].query(q.texto, q.v)).rowCount ?? 0; },
};
vi.mock("../../src/lib/db", () => ({ prisma: () => db }));

const k = () => crypto.randomBytes(32).toString("base64");
let rl: typeof import("../../src/lib/rate-limit");
let lp: typeof import("../../src/lib/login-protecao");
const sql = async (t: string, v: unknown[] = []) => (await pools[0].query(t, v)).rows;

beforeAll(async () => {
  if (!URL_TESTE) return;
  Object.assign(process.env, { DATABASE_URL: "postgresql://x:y@localhost:5432/z", JWT_SECRET: "x".repeat(48), DATA_ENCRYPTION_KEYS: `k1:${k()}`, BLIND_INDEX_KEY: k() });
  for (let i = 0; i < 3; i++) pools.push(new pg.Pool({ connectionString: URL_TESTE, max: 10 }));
  rl = await import("../../src/lib/rate-limit");
  lp = await import("../../src/lib/login-protecao");
});
afterAll(async () => { await Promise.all(pools.map((p) => p.end())); });

describe.skipIf(!URL_TESTE)("rate limit distribuído em PostgreSQL (fonte única)", () => {
  beforeEach(async () => { await sql("DELETE FROM rate_limits"); });

  it("não existe contador em memória: o código só usa o banco", () => {
    const src = readFileSync(new URL("../../src/lib/rate-limit.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/new Map\(|globalThis/);
  });

  it("atomicidade com concorrência em 3 instâncias: 300 chamadas paralelas, max 100 → exatamente 100 passam", async () => {
    const regra = { nome: "t-conc", max: 100, janelaSeg: 60 };
    const r = await Promise.allSettled(Array.from({ length: 300 }, () => rl.limitar(regra, "chave-unica")));
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(100);
    expect(r.filter((x) => x.status === "rejected").length).toBe(200);
    const [{ contagem }] = await sql("SELECT contagem FROM rate_limits WHERE chave LIKE 't-conc:%'");
    expect(contagem).toBe(300); // nenhum incremento perdido
  });

  it("429 traz Retry-After coerente com a janela restante", async () => {
    const regra = { nome: "t-429", max: 1, janelaSeg: 120 };
    await rl.limitar(regra, "a");
    const e = await rl.limitar(regra, "a").catch((x) => x);
    expect(e.status).toBe(429);
    expect(e.extra.retryAfter).toBeGreaterThan(100); expect(e.extra.retryAfter).toBeLessThanOrEqual(120);
  });

  it("expiração: depois da janela o contador recomeça em 1 (relógio do banco, não do processo)", async () => {
    const regra = { nome: "t-exp", max: 2, janelaSeg: 60 };
    for (let i = 0; i < 3; i++) await rl.contar(regra, "x");
    await sql("UPDATE rate_limits SET expira_em = now() - interval '1 second' WHERE chave LIKE 't-exp:%'");
    expect((await rl.contar(regra, "x")).contagem).toBe(1);
    expect((await rl.limitar(regra, "x")).contagem).toBe(2);
  });

  it("janela real curta: 1 s expira de verdade", async () => {
    const regra = { nome: "t-1s", max: 1, janelaSeg: 1 };
    await rl.limitar(regra, "y");
    await expect(rl.limitar(regra, "y")).rejects.toMatchObject({ status: 429 });
    await new Promise((r) => setTimeout(r, 1300));
    await expect(rl.limitar(regra, "y")).resolves.toBeTruthy();
  });

  it("chaves são HMAC: IP e e-mail nunca aparecem em claro na tabela", async () => {
    await rl.limitar({ nome: "t-hmac", max: 9, janelaSeg: 60 }, "203.0.113.9|vitima@example.com");
    const chaves = (await sql("SELECT chave FROM rate_limits")).map((r) => r.chave as string).join(" ");
    expect(chaves).toMatch(/^t-hmac:[a-f0-9]{32}$/);
    expect(chaves).not.toMatch(/203|vitima|example/);
  });

  it("estornar nunca passa de zero e zerar apaga; limparExpirados remove só o vencido", async () => {
    const regra = { nome: "t-est", max: 5, janelaSeg: 60 };
    await rl.contar(regra, "z"); await rl.estornar(regra, "z"); await rl.estornar(regra, "z");
    expect((await sql("SELECT contagem FROM rate_limits WHERE chave LIKE 't-est:%'"))[0].contagem).toBe(0);
    await rl.zerar(regra, "z");
    expect(await sql("SELECT 1 FROM rate_limits WHERE chave LIKE 't-est:%'")).toHaveLength(0);
    await rl.contar({ nome: "t-velho", janelaSeg: 60 }, "a"); await rl.contar({ nome: "t-novo", janelaSeg: 60 }, "a");
    await sql("UPDATE rate_limits SET expira_em = now() - interval '2 hours' WHERE chave LIKE 't-velho:%'");
    expect(await rl.limparExpirados()).toBe(1);
    expect(await sql("SELECT 1 FROM rate_limits WHERE chave LIKE 't-novo:%'")).toHaveLength(1);
  });

  it("IPs diferentes têm contadores independentes", async () => {
    const regra = { nome: "t-ips", max: 1, janelaSeg: 60 };
    await rl.limitar(regra, "198.51.100.1");
    await expect(rl.limitar(regra, "198.51.100.1")).rejects.toMatchObject({ status: 429 });
    await expect(rl.limitar(regra, "198.51.100.2")).resolves.toBeTruthy();
  });
});

describe.skipIf(!URL_TESTE)("proteção de login (cenários de ataque)", () => {
  const base = { ipConfiavel: true, dispositivoConhecido: false };
  const falhar = (ip: string, email: string, extra = {}) => lp.reservarTentativaLogin({ ...base, ip, email, ...extra });
  beforeEach(async () => { await sql("DELETE FROM rate_limits"); });

  it("terceiro errando a senha da vítima bloqueia o PRÓPRIO IP+e-mail, não a vítima em outro IP", async () => {
    for (let i = 0; i < 8; i++) await falhar("198.51.100.66", "vitima@example.com");
    await expect(falhar("198.51.100.66", "vitima@example.com")).rejects.toMatchObject({ status: 429 });
    const v = await falhar("203.0.113.10", "vitima@example.com");
    await v.sucesso();
  });

  it("login correto depois de falhas: sucesso devolve o orçamento e zera IP+e-mail", async () => {
    for (let i = 0; i < 5; i++) await falhar("203.0.113.10", "ana@example.com");
    const ok = await falhar("203.0.113.10", "ana@example.com"); await ok.sucesso();
    const [{ contagem: c }] = await sql("SELECT COALESCE(SUM(contagem),0)::int AS contagem FROM rate_limits WHERE chave LIKE 'login-falha:%'");
    expect(c).toBe(0);
    for (let i = 0; i < 8; i++) await falhar("203.0.113.10", "ana@example.com"); // orçamento cheio de novo
  });

  it("pedido do código MFA (nada adivinhado) é devolvido e não gasta tentativa", async () => {
    for (let i = 0; i < 30; i++) { const r = await falhar("203.0.113.11", "adm@example.com"); await r.devolver(); }
    await expect(falhar("203.0.113.11", "adm@example.com")).resolves.toBeTruthy();
  });

  it("muitos IPs contra a mesma conta: contenção bloqueia estranhos com Retry-After; o dono com cookie de dispositivo entra", async () => {
    for (let i = 0; i < 15; i++) await falhar(`198.51.100.${i + 1}`, "alvo@example.com");
    const e = await falhar("198.51.100.200", "alvo@example.com").catch((x) => x);
    expect(e.status).toBe(429); expect(e.extra.retryAfter).toBeGreaterThan(0);
    const dono = await falhar("203.0.113.77", "alvo@example.com", { dispositivoConhecido: true });
    await dono.sucesso();
  });

  it("contenção é progressiva: 15 min → 30 min → 60 min ao reincidir", async () => {
    const seg: number[] = [];
    for (let rodada = 0; rodada < 3; rodada++) {
      await sql("DELETE FROM rate_limits WHERE chave LIKE 'login-conta:%'");
      for (let i = 0; i < 15; i++) await falhar(`198.51.100.${i + 1}`, "alvo2@example.com");
      const e = await falhar("198.51.100.250", "alvo2@example.com").catch((x) => x);
      seg.push(e.extra.retryAfter);
    }
    expect(seg[0]).toBeGreaterThan(800); expect(seg[0]).toBeLessThanOrEqual(900);
    expect(seg[1]).toBeGreaterThan(1700); expect(seg[1]).toBeLessThanOrEqual(1800);
    expect(seg[2]).toBeGreaterThan(3500); expect(seg[2]).toBeLessThanOrEqual(3600);
    expect(lp.duracaoContencao(99)).toBe(4 * 3600);
  });

  it("dono com dispositivo também tem teto (cookie roubado não dá tentativas infinitas)", async () => {
    await sql("INSERT INTO rate_limits (chave, contagem, expira_em) SELECT 'x', 0, now()"); // garante tabela ok
    const alvo = "teto@example.com";
    await lp.reservarTentativaLogin({ ...base, ip: "203.0.113.1", email: alvo, dispositivoConhecido: true });
    await sql("UPDATE rate_limits SET contagem = 100 WHERE chave LIKE 'login-conta:%'");
    await expect(lp.reservarTentativaLogin({ ...base, ip: "203.0.113.1", email: alvo, dispositivoConhecido: true })).rejects.toMatchObject({ status: 429 });
  });

  it("sem IP confiável: não cria baldes por IP nem por IP+e-mail (ninguém é bloqueado por um balde global)", async () => {
    for (let i = 0; i < 12; i++) { const r = await lp.reservarTentativaLogin({ ip: "desconhecido", ipConfiavel: false, email: `u${i}@example.com`, dispositivoConhecido: false }); await r.devolver(); }
    const chaves = (await sql("SELECT chave FROM rate_limits")).map((r) => r.chave as string);
    expect(chaves.some((c) => c.startsWith("login-falha"))).toBe(false);
    expect(chaves.every((c) => c.startsWith("login-conta:"))).toBe(true);
  });

  it("concorrência no login: 50 tentativas paralelas erradas não passam do limite por IP+e-mail", async () => {
    const r = await Promise.allSettled(Array.from({ length: 50 }, () => falhar("203.0.113.50", "par@example.com")));
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(8);
  });
});

// ---- Nível HTTP: passa pelo wrapper api() de verdade (status 429 e Retry-After) ----------------------------
describe.skipIf(!URL_TESTE)("HTTP: 429, Retry-After e cabeçalhos forjados", () => {
  beforeEach(async () => { await sql("DELETE FROM rate_limits"); });
  async function rota(proxy: string) {
    vi.resetModules();
    process.env.TRUSTED_PROXY = proxy;
    const { api } = await import("../../src/lib/api");
    const { NextRequest } = await import("next/server");
    const POST = api({ auth: false, limites: [{ nome: "t-http-ip", por: "ip", max: 3, janelaSeg: 600 }] }, async () => ({ sucesso: true }));
    const chamar = (h: Record<string, string>) => POST(new NextRequest("http://localhost/api/x", { method: "POST", headers: h }), { params: Promise.resolve({}) });
    return chamar;
  }

  it("mesmo IP repetido: passa até o limite e depois 429 com Retry-After numérico", async () => {
    const chamar = await rota("railway");
    for (let i = 0; i < 3; i++) expect((await chamar({ "x-real-ip": "203.0.113.5" })).status).toBe(200);
    const r = await chamar({ "x-real-ip": "203.0.113.5" });
    expect(r.status).toBe(429);
    const ra = Number(r.headers.get("retry-after"));
    expect(ra).toBeGreaterThan(0); expect(ra).toBeLessThanOrEqual(600);
  });

  it("IPs diferentes não se afetam", async () => {
    const chamar = await rota("railway");
    for (let i = 0; i < 4; i++) await chamar({ "x-real-ip": "203.0.113.5" });
    expect((await chamar({ "x-real-ip": "203.0.113.6" })).status).toBe(200);
  });

  it("falsificar X-Forwarded-For / CF-Connecting-IP não escapa do limite", async () => {
    const chamar = await rota("railway");
    for (let i = 0; i < 3; i++) await chamar({ "x-real-ip": "203.0.113.5" });
    for (let i = 0; i < 5; i++) {
      const r = await chamar({ "x-real-ip": "203.0.113.5", "x-forwarded-for": `9.9.9.${i}`, "cf-connecting-ip": `8.8.8.${i}` });
      expect(r.status).toBe(429);
    }
  });

  it("sem IP confiável a rota NÃO fica sem proteção: balde global com teto 10x (e não pula em silêncio)", async () => {
    const chamar = await rota("none");
    let ok = 0, limitado = 0;
    for (let i = 0; i < 35; i++) { const r = await chamar({ "x-forwarded-for": `9.9.9.${i}` }); r.status === 200 ? ok++ : limitado++; }
    expect(ok).toBe(30); expect(limitado).toBe(5);
    const [{ n }] = await sql("SELECT count(*)::int AS n FROM rate_limits WHERE chave LIKE 't-http-ip:%'");
    expect(n).toBe(1); // um único balde global
  });
});
