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
