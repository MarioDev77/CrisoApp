import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

// Estes testes não usam banco: o Prisma e o rate limit são trocados por dublês em memória.
const SEGREDO_RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 de "12345678901234567890"; no instante 59 s o código é 287082
const SESSION = "s".repeat(48);
const JWT_ANTIGO = "j".repeat(48);

function ambiente(nodeEnv: "production" | "test") {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("DATABASE_URL", "postgresql://x:y@localhost:5432/z");
  vi.stubEnv("SESSION_SECRET", SESSION);
  vi.stubEnv("JWT_SECRET", JWT_ANTIGO);
  vi.stubEnv("OTP_PEPPER", "o".repeat(48));
  vi.stubEnv("QR_SIGNING_SECRET", "q".repeat(48));
  // chaves AES/HMAC fixas só para teste (32 bytes em base64)
  vi.stubEnv("DATA_ENCRYPTION_KEYS", `k1:${Buffer.alloc(32, 1).toString("base64")}`);
  vi.stubEnv("BLIND_INDEX_KEY", Buffer.alloc(32, 2).toString("base64"));
}

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("MFA: o mesmo código TOTP não vale duas vezes", () => {
  async function carregar() {
    ambiente("test");
    const usados = new Set<string>();
    const { HttpError } = await import("../../src/lib/errors");
    // dublê do contador atômico: 1º uso passa, repetição levanta 429 (como o limitar real com max=1)
    vi.doMock("../../src/lib/rate-limit", () => ({
      limitar: async (regra: { nome: string }, id: string) => {
        const k = `${regra.nome}:${id}`;
        if (usados.has(k)) throw new HttpError(429, "limite");
        usados.add(k);
      },
    }));
    const mfa = await import("../../src/lib/mfa");
    const updateMany = vi.fn(async () => ({ count: 0 })); // nenhum código de recuperação confere
    vi.doMock("../../src/lib/db", () => ({
      prisma: () => ({
        mfaConta: { findUnique: async () => ({ id: 7, habilitado: true, segredoEnc: mfa.cifrarSegredoTotp(SEGREDO_RFC), recoveryHashes: [] }) },
        mfaCodigo: { updateMany },
      }),
    }));
    const m = await import("../../src/lib/mfa-codigos");
    return { m, HttpError };
  }

  it("aceita o código na 1ª vez e recusa o reenvio do mesmo código", async () => {
    vi.useFakeTimers({ now: 59_000 });
    const { m } = await carregar();
    const conta = { tipo: "usuario" as const, id: 1 };
    await expect(m.exigirMfaNoLogin(conta, "admin", "287082")).resolves.toEqual({ mfa: true, setup: false });
    await expect(m.exigirMfaNoLogin(conta, "admin", "287082")).rejects.toMatchObject({ status: 401 });
  });

  it("código errado não 'gasta' o código certo", async () => {
    vi.useFakeTimers({ now: 59_000 });
    const { m } = await carregar();
    const conta = { tipo: "usuario" as const, id: 1 };
    await expect(m.exigirMfaNoLogin(conta, "admin", "000000")).rejects.toMatchObject({ status: 401 });
    await expect(m.exigirMfaNoLogin(conta, "admin", "287082")).resolves.toMatchObject({ mfa: true });
  });

  it("o mesmo código em contas diferentes não se bloqueia", async () => {
    vi.useFakeTimers({ now: 59_000 });
    const { m } = await carregar();
    await expect(m.exigirMfaNoLogin({ tipo: "usuario", id: 1 }, "admin", "287082")).resolves.toMatchObject({ mfa: true });
    await expect(m.exigirMfaNoLogin({ tipo: "loja", id: 1 }, "loja", "287082")).resolves.toMatchObject({ mfa: true });
  });

  it("se o contador falhar (banco fora), NÃO libera o login: propaga o erro", async () => {
    ambiente("test");
    vi.doMock("../../src/lib/rate-limit", () => ({ limitar: async () => { throw new Error("banco indisponível"); } }));
    vi.doMock("../../src/lib/db", () => ({ prisma: () => ({}) }));
    const m = await import("../../src/lib/mfa-codigos");
    await expect(m.totpAindaNaoUsado({ tipo: "usuario", id: 1 }, "123456")).rejects.toThrow("banco indisponível");
  });
});

describe("sessão: legados não valem em produção", () => {
  const usuarioAtivo = { id: 1, tipo: "cliente", status: "ativo", deletadoEm: null, versaoSessao: 0, nome: "Ana", email: "ana@exemplo.com", emailEnc: null };

  async function carregarAuth(nodeEnv: "production" | "test") {
    ambiente(nodeEnv);
    vi.doMock("../../src/lib/db", () => ({ prisma: () => ({ usuario: { findUnique: async () => usuarioAtivo }, loja: { findUnique: async () => null } }) }));
    return import("../../src/lib/auth");
  }
  const req = (cookie: string) => new Request("https://x.test/api/x", { headers: { cookie } });

  it("produção: cookie __Host- válido autentica", async () => {
    const a = await carregarAuth("production");
    const token = await a.emitirSessao({ id: 1, tipo: "cliente", versao: 0 });
    await expect(a.autenticar(req(`__Host-crisoverde_session=${token}`))).resolves.toMatchObject({ id: 1, tipo: "cliente" });
  });

  it("produção: o nome antigo do cookie (sem __Host-) é ignorado", async () => {
    const a = await carregarAuth("production");
    const token = await a.emitirSessao({ id: 1, tipo: "cliente", versao: 0 });
    await expect(a.autenticar(req(`crisoverde_session=${token}`))).rejects.toMatchObject({ status: 401 });
  });

  it("produção: token assinado com a JWT_SECRET antiga é recusado", async () => {
    const a = await carregarAuth("production");
    const antigo = await new SignJWT({ tipo: "cliente", v: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject("1").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(JWT_ANTIGO));
    await expect(a.autenticar(req(`__Host-crisoverde_session=${antigo}`))).rejects.toMatchObject({ status: 401 });
  });

  it("desenvolvimento/teste: continua aceitando o legado (para não quebrar o ambiente local)", async () => {
    const a = await carregarAuth("test");
    const antigo = await new SignJWT({ tipo: "cliente", v: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject("1").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(JWT_ANTIGO));
    await expect(a.autenticar(req(`crisoverde_session=${antigo}`))).resolves.toMatchObject({ id: 1 });
  });

  it("token de outro tipo/assinatura adulterada é recusado", async () => {
    const a = await carregarAuth("production");
    const token = await a.emitirSessao({ id: 1, tipo: "cliente", versao: 0 });
    const adulterado = token.slice(0, -3) + (token.endsWith("AAA") ? "BBB" : "AAA");
    await expect(a.autenticar(req(`__Host-crisoverde_session=${adulterado}`))).rejects.toMatchObject({ status: 401 });
  });
});
