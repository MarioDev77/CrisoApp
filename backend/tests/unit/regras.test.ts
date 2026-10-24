import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://x:y@localhost:5432/z";
  process.env.JWT_SECRET = "x".repeat(48);
  process.env.TRUSTED_PROXY = "hops";
  process.env.TRUSTED_PROXY_HOPS = "1";
});

describe("créditos e kg (regras originais)", () => {
  it("calcula 0,25 por bloco conforme as taxas", async () => {
    const { calcularCreditos } = await import("../../src/lib/materiais");
    const taxas = { papelao: 7, plastico: 10, aluminio: 6, vidro: 4 };
    expect(calcularCreditos({ papelao: 14, plastico: 0, aluminio: 0, vidro: 0 }, taxas)).toBe(0.5);
    expect(calcularCreditos({ papelao: 6, plastico: 9, aluminio: 5, vidro: 3 }, taxas)).toBe(0); // abaixo do bloco
    expect(calcularCreditos({ papelao: 7, plastico: 10, aluminio: 6, vidro: 4 }, taxas)).toBe(1);
  });
  it("kg = 0,05 por unidade, qualquer material", async () => {
    const { calcularKg } = await import("../../src/lib/materiais");
    expect(calcularKg({ papelao: 14, plastico: 0, aluminio: 0, vidro: 0 })).toBe(0.7);
    expect(calcularKg({ papelao: 10, plastico: 10, aluminio: 10, vidro: 10 })).toBe(2);
  });
  it("teto de unidades por material (anti-fraude)", async () => {
    const { materiaisSchema } = await import("../../src/lib/materiais");
    expect(materiaisSchema().safeParse({ papelao: 1000 }).success).toBe(true);
    expect(materiaisSchema().safeParse({ papelao: 1001 }).success).toBe(false);
    expect(materiaisSchema().safeParse({ papelao: -1 }).success).toBe(false);
    expect(materiaisSchema().safeParse({ papelao: 1.5 }).success).toBe(false);
  });
});

describe("IP do cliente (só cabeçalhos confiáveis)", () => {
  it("usa o último salto de X-Forwarded-For e ignora o que o cliente forjou", async () => {
    const { clientIp } = await import("../../src/lib/client-ip");
    const h = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" });
    expect(clientIp(h)).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBe("desconhecido");
  });
});

describe("identificador temporário do cliente", () => {
  it("aceita o gerado, rejeita adulterado e expirado", async () => {
    const { gerarIdentificadorCliente, verificarIdentificadorCliente } = await import("../../src/lib/auth");
    const ok = gerarIdentificadorCliente(42);
    expect(verificarIdentificadorCliente(ok)).toBe(42);
    expect(verificarIdentificadorCliente(ok.replace(/^42/, "43"))).toBeNull();
    const [id, , sig] = ok.split(".");
    expect(verificarIdentificadorCliente(`${id}.1.${sig}`)).toBeNull();
    expect(verificarIdentificadorCliente("lixo")).toBeNull();
  });
});

describe("senha", () => {
  it("exige 8+ caracteres com letras e números", async () => {
    const { senhaNova } = await import("../../src/lib/schemas");
    expect(senhaNova.safeParse("abcdefgh").success).toBe(false);
    expect(senhaNova.safeParse("12345678").success).toBe(false);
    expect(senhaNova.safeParse("abc12345").success).toBe(true);
    expect(senhaNova.safeParse("a1".repeat(40)).success).toBe(false); // > 72 (limite do bcrypt)
  });
});
