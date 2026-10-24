import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

const k = () => crypto.randomBytes(32).toString("base64");
const K1 = k(), K2 = k(), IDX = k();

async function carregar(chaves = `k1:${K1}`, idx = IDX) {
  vi.resetModules();
  process.env.DATABASE_URL = "postgresql://x:y@localhost:5432/z";
  process.env.JWT_SECRET = "x".repeat(48);
  process.env.DATA_ENCRYPTION_KEYS = chaves;
  process.env.BLIND_INDEX_KEY = idx;
  return import("../../src/lib/crypto");
}

describe("cifrar / decifrar", () => {
  it("faz ida e volta, inclusive com acentos", async () => {
    const c = await carregar();
    const t = "maria.açaí@email.com";
    const b = c.cifrar(t, "usuarios.email");
    expect(b).not.toContain("maria");
    expect(c.decifrar(b, "usuarios.email")).toBe(t);
  });
  it("IV aleatório: o mesmo texto gera cifras diferentes", async () => {
    const c = await carregar();
    expect(c.cifrar("a", "x")).not.toBe(c.cifrar("a", "x"));
  });
  it("detecta adulteração", async () => {
    const c = await carregar();
    const p = c.cifrar("segredo", "x").split(".");
    p[4] = Buffer.from("outro").toString("base64url");
    expect(() => c.decifrar(p.join("."), "x")).toThrow("Falha ao decifrar");
  });
  it("não abre em outro contexto (impede trocar valores entre colunas)", async () => {
    const c = await carregar();
    expect(() => c.decifrar(c.cifrar("11999998888", "usuarios.telefone"), "lojas.telefone")).toThrow();
  });
  it("rotação: chave nova cifra, chave antiga ainda decifra", async () => {
    const antigo = (await carregar(`k1:${K1}`)).cifrar("valor", "x");
    const c = await carregar(`k2:${K2},k1:${K1}`);
    expect(c.decifrar(antigo, "x")).toBe("valor");
    expect(c.precisaRotacionar(antigo)).toBe(true);
    expect(c.precisaRotacionar(c.cifrar("valor", "x"))).toBe(false);
  });
  it("sem a chave antiga na lista, não decifra", async () => {
    const antigo = (await carregar(`k1:${K1}`)).cifrar("valor", "x");
    const c = await carregar(`k2:${K2}`);
    expect(() => c.decifrar(antigo, "x")).toThrow();
  });
  it("opcionais: null/vazio passam direto", async () => {
    const c = await carregar();
    expect(c.cifrarOpt(null, "x")).toBeNull();
    expect(c.cifrarOpt("", "x")).toBeNull();
    expect(c.decifrarOpt(null, "x")).toBeNull();
    expect(c.estaCifrado(c.cifrar("a", "x"))).toBe(true);
    expect(c.estaCifrado("maria@email.com")).toBe(false);
  });
});

describe("configuração", () => {
  it("rejeita chave com tamanho errado", async () => {
    const c = await carregar(`k1:${Buffer.from("curta").toString("base64")}`);
    expect(() => c.cifrar("a", "x")).toThrow(/32 bytes/);
  });
  it("rejeita blind index igual à chave de criptografia", async () => {
    const c = await carregar(`k1:${K1}`, K1);
    expect(() => c.cifrar("a", "x")).toThrow(/diferente/);
  });
  it("rejeita ids repetidos e formato inválido", async () => {
    const a = await carregar(`k1:${K1},k1:${K2}`);
    expect(() => a.cifrar("a", "x")).toThrow(/repetido/);
    const b = await carregar("sem-dois-pontos");
    expect(() => b.cifrar("a", "x")).toThrow(/inválida/);
  });
});

describe("blind index", () => {
  it("e-mail: determinístico e insensível a caixa/espaços", async () => {
    const c = await carregar();
    expect(c.hashEmail(" Maria@Email.COM ")).toBe(c.hashEmail("maria@email.com"));
    expect(c.hashEmail("a@x.com")).not.toBe(c.hashEmail("b@x.com"));
    expect(c.hashEmail("a@x.com")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("telefone: normaliza formatos brasileiros", async () => {
    const c = await carregar();
    expect(c.normalizarTelefone("(75) 99999-8888")).toBe("5575999998888");
    expect(c.hashTelefone("75999998888")).toBe(c.hashTelefone("+55 (75) 99999-8888"));
  });
  it("contextos diferentes geram índices diferentes", async () => {
    const c = await carregar();
    expect(c.indiceCego("x", "email")).not.toBe(c.indiceCego("x", "telefone"));
  });
  it("chave de blind index diferente muda o resultado", async () => {
    const a = (await carregar(`k1:${K1}`, k())).hashEmail("a@x.com");
    const b = (await carregar(`k1:${K1}`, k())).hashEmail("a@x.com");
    expect(a).not.toBe(b);
  });
  it("hash de token de QR e chave de rate limit", async () => {
    const c = await carregar();
    const t = crypto.randomUUID();
    expect(c.hashTokenQr(t)).toBe(c.hashTokenQr(t));
    expect(c.hashTokenQr(t)).not.toContain(t);
    expect(c.chaveRateLimit("1.2.3.4|MARIA@x.com")).toBe(c.chaveRateLimit("1.2.3.4|maria@x.com"));
    expect(c.chaveRateLimit("1.2.3.4|maria@x.com")).toHaveLength(32);
  });
});

describe("payload selado (QR do cliente)", () => {
  beforeEach(() => vi.useRealTimers());
  it("abre dentro da validade e não expõe o id", async () => {
    const c = await carregar();
    const s = c.selar({ id: 4242 }, "cliente-qr", 90);
    expect(s).not.toContain("4242");
    expect(c.abrir<{ id: number }>(s, "cliente-qr")?.id).toBe(4242);
  });
  it("expira", async () => {
    const c = await carregar();
    vi.useFakeTimers();
    const s = c.selar({ id: 1 }, "cliente-qr", 90);
    vi.advanceTimersByTime(91_000);
    expect(c.abrir(s, "cliente-qr")).toBeNull();
  });
  it("contexto errado, lixo e adulteração retornam null", async () => {
    const c = await carregar();
    const s = c.selar({ id: 1 }, "cliente-qr", 90);
    expect(c.abrir(s, "outro")).toBeNull();
    expect(c.abrir("lixo", "cliente-qr")).toBeNull();
    expect(c.abrir(s.slice(0, -2) + "xx", "cliente-qr")).toBeNull();
  });
});

describe("máscaras", () => {
  it("não deixam o dado inteiro", async () => {
    const c = await carregar();
    expect(c.mascararEmail("maria@gmail.com")).toBe("m***@gmail.com");
    expect(c.mascararTelefone("(75) 99999-8888")).toBe("***8888");
  });
});
