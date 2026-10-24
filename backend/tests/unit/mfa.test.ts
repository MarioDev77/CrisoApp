import { describe, expect, it } from "vitest";
import { base32, verificarTotp } from "../../src/lib/mfa";

describe("TOTP (RFC 6238 / SHA-1)", () => {
  it("valida o vetor RFC no instante 59s, com seis dígitos", () => {
    const secret = base32(Buffer.from("12345678901234567890"));
    expect(verificarTotp(secret, "287082", 59_000)).toBe(true);
    expect(verificarTotp(secret, "287083", 59_000)).toBe(false);
  });

  it("aceita a janela de tolerância de 30s e recusa formato inválido", () => {
    const secret = base32(Buffer.from("12345678901234567890"));
    expect(verificarTotp(secret, "287082", 89_000)).toBe(true);
    expect(verificarTotp(secret, "12x456", 59_000)).toBe(false);
    expect(verificarTotp(secret, "12345", 59_000)).toBe(false);
  });
});

describe("códigos de recuperação cifrados", () => {
  async function carregar() {
    const { vi } = await import("vitest");
    const crypto = await import("node:crypto");
    vi.resetModules();
    process.env.DATABASE_URL = "postgresql://x:y@localhost:5432/z";
    process.env.JWT_SECRET = "x".repeat(48);
    process.env.DATA_ENCRYPTION_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.BLIND_INDEX_KEY = crypto.randomBytes(32).toString("base64");
    return import("../../src/lib/mfa");
  }

  it("cifra, não deixa o código em claro e decifra de volta", async () => {
    const m = await carregar();
    const { codes } = m.novosCodigosRecuperacao();
    const blob = m.cifrarCodigoRecuperacao(codes[0]);
    expect(blob).not.toContain(codes[0]);
    expect(m.decifrarCodigoRecuperacao(blob)).toBe(codes[0]);
  });

  it("gera 8 códigos únicos e o hash ignora caixa e espaços", async () => {
    const m = await carregar();
    const { codes, hashes } = m.novosCodigosRecuperacao();
    expect(new Set(codes).size).toBe(8);
    expect(m.hashRecoveryCode(` ${codes[0].toLowerCase()} `)).toBe(hashes[0]);
  });

  it("o texto cifrado do código não abre em outro contexto (ex.: segredo TOTP)", async () => {
    const m = await carregar();
    const blob = m.cifrarCodigoRecuperacao("ABCDEF123456");
    expect(() => m.decifrarSegredoTotp(blob)).toThrow();
  });
});
