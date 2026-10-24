import { describe, it, expect, beforeAll, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    usuarioFindUnique: vi.fn(),
    lojaFindUnique: vi.fn(),
    queryRaw: vi.fn(),
  },
}));

vi.mock("../../src/lib/db", () => ({
  prisma: () => ({
    usuario: { findUnique: prismaMock.usuarioFindUnique },
    loja: { findUnique: prismaMock.lojaFindUnique },
    $queryRaw: prismaMock.queryRaw,
  }),
}));

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
    expect(materiaisSchema().safeParse({ papelao: 200 }).success).toBe(true);
    expect(materiaisSchema().safeParse({ papelao: 201 }).success).toBe(false);
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

  it("não usa IP desconhecido para aplicar um limite compartilhado", async () => {
    const { deveAplicarLimiteIp } = await import("../../src/lib/api");
    expect(deveAplicarLimiteIp("desconhecido")).toBe(false);
    expect(deveAplicarLimiteIp("203.0.113.9")).toBe(true);
  });
});

describe("limite por e-mail", () => {
  it("usa chave fixa derivada do e-mail normalizado, sem gravar o e-mail em claro", async () => {
    const { limitar } = await import("../../src/lib/rate-limit");
    const { createHash } = await import("node:crypto");
    prismaMock.queryRaw.mockResolvedValueOnce([{ contagem: 1, ttl: 900 }]);
    await limitar({ nome: "login-email", max: 20, janelaSeg: 900 }, "USER@Example.Test", true);
    const chaveGravada = prismaMock.queryRaw.mock.calls.at(-1)?.[1];
    expect(chaveGravada).toMatch(/^login-email:[a-f0-9]{32}$/);
    expect(chaveGravada).not.toContain("user@example.test");
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

describe("vínculo Google com conta local não verificada", () => {
  it("apaga a senha anterior e invalida a sessão emitida antes do vínculo", async () => {
    const { dadosVinculoGoogle } = await import("../../src/lib/google-link");
    const atualizacao = dadosVinculoGoogle({ senha: "hash-antigo", emailVerificado: false }, "google-sub", null);
    expect(atualizacao.senha).toBeNull();
    expect(atualizacao.versaoSessao).toEqual({ increment: 1 });
    expect(atualizacao.emailVerificado).toBe(true);

    const { autenticar, emitirSessao } = await import("../../src/lib/auth");
    const sessaoAntiga = await emitirSessao({ id: 73, tipo: "cliente", versao: 4 });
    prismaMock.usuarioFindUnique.mockResolvedValueOnce({
      id: 73, nome: "Cliente", email: "cliente@example.test", senha: null, tipo: "cliente",
      status: "ativo", deletadoEm: null, versaoSessao: 5,
    });
    const request = new Request("http://localhost/api/cliente/carteira", {
      headers: { cookie: `crisoverde_session=${sessaoAntiga}` },
    });
    await expect(autenticar(request)).rejects.toThrow("Sessão encerrada");
  });

  it("mantém a senha quando a conta local já verificou o e-mail", async () => {
    const { dadosVinculoGoogle } = await import("../../src/lib/google-link");
    const atualizacao = dadosVinculoGoogle({ senha: "hash-antigo", emailVerificado: true }, "google-sub", null);
    expect("senha" in atualizacao).toBe(false);
    expect("versaoSessao" in atualizacao).toBe(false);
  });
});

describe("busca de clientes da loja", () => {
  it("aceita apenas e-mail completo ou nome com pelo menos três caracteres", async () => {
    const { filtroBuscaCliente } = await import("../../src/lib/client-search");
    expect(filtroBuscaCliente("Ma")).toBeNull();
    expect(filtroBuscaCliente("maria@")).toBeNull();
    expect(filtroBuscaCliente("MARIA@EMAIL.COM")).toEqual({ email: "maria@email.com" });
    expect(filtroBuscaCliente("O'Neil")).toEqual({ nome: { contains: "O'Neil", mode: "insensitive" } });
  });

  it("expõe somente id e nome na resposta da busca", async () => {
    const { resumoClienteBusca } = await import("../../src/lib/client-search");
    const clienteCompleto = { id: 17, nome: "Maria", saldo: 500, totalTrocas: 9 };
    const resumo = resumoClienteBusca(clienteCompleto);
    expect(resumo).toEqual({ id: 17, nome: "Maria" });
    expect("saldo" in resumo).toBe(false);
    expect("total_trocas" in resumo).toBe(false);
  });
});
