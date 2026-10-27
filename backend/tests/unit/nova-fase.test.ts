import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../../src/lib/db", () => ({ prisma: () => ({}) }));
beforeAll(() => { process.env.DATABASE_URL = "postgresql://x:y@localhost:5432/z"; process.env.JWT_SECRET = "x".repeat(48); });

describe("impacto: período", () => {
  it("padrão = últimos 30 dias incluindo hoje", async () => {
    const { resolverPeriodo } = await import("../../src/lib/impacto");
    expect(resolverPeriodo({}, "2026-10-27")).toEqual({ de: "2026-09-28", ate: "2026-10-27", dias: 30 });
    expect(resolverPeriodo({ dias: 1 }, "2026-10-27")).toEqual({ de: "2026-10-27", ate: "2026-10-27", dias: 1 });
  });
  it("recusa data invertida e período acima de 366 dias", async () => {
    const { resolverPeriodo } = await import("../../src/lib/impacto");
    expect(() => resolverPeriodo({ de: "2026-05-10", ate: "2026-05-01" }, "2026-10-27")).toThrow();
    expect(() => resolverPeriodo({ de: "2024-01-01", ate: "2026-01-01" }, "2026-10-27")).toThrow();
  });
  it("período anterior tem o mesmo tamanho e termina na véspera", async () => {
    const { periodoAnterior } = await import("../../src/lib/impacto");
    expect(periodoAnterior({ de: "2026-10-01", dias: 10 })).toEqual({ de: "2026-09-21", ate: "2026-09-30", dias: 10 });
  });
  it("valida datas reais (30/02 e mês 13 são inválidos)", async () => {
    const { impactoQuery } = await import("../../src/lib/impacto");
    expect(impactoQuery.safeParse({ de: "2026-02-30" }).success).toBe(false);
    expect(impactoQuery.safeParse({ de: "2026-13-01" }).success).toBe(false);
    expect(impactoQuery.safeParse({ de: "2026-02-28", ate: "2026-03-01" }).success).toBe(true);
    expect(impactoQuery.safeParse({ material: "ouro" }).success).toBe(false);
  });
});

describe("impacto: série e variação", () => {
  it("preenche dias sem registro com zero", async () => {
    const { preencherSerie } = await import("../../src/lib/impacto");
    const s = preencherSerie([{ periodo: "2026-10-02", operacoes: 2, kg: 1, unidades: 20 }], "2026-10-01", "2026-10-04", "dia");
    expect(s.map((p) => [p.periodo, p.operacoes])).toEqual([["2026-10-01", 0], ["2026-10-02", 2], ["2026-10-03", 0], ["2026-10-04", 0]]);
  });
  it("semanas começam na segunda-feira e meses no dia 1", async () => {
    const { preencherSerie } = await import("../../src/lib/impacto");
    const sem = preencherSerie([], "2026-10-07", "2026-10-20", "semana"); // 07/10/2026 é quarta
    expect(sem.map((p) => p.periodo)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    const mes = preencherSerie([], "2026-08-15", "2026-10-02", "mes");
    expect(mes.map((p) => p.periodo)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });
  it("granularidade por tamanho do período", async () => {
    const { escolherGranularidade } = await import("../../src/lib/impacto");
    expect([escolherGranularidade(30), escolherGranularidade(120), escolherGranularidade(300)]).toEqual(["dia", "semana", "mes"]);
  });
  it("variação percentual não divide por zero", async () => {
    const { variacaoPercentual } = await import("../../src/lib/impacto");
    expect(variacaoPercentual(15, 10)).toBe(50);
    expect(variacaoPercentual(5, 10)).toBe(-50);
    expect(variacaoPercentual(5, 0)).toBeNull();
  });
});

describe("recompensas: regras", () => {
  it("motivo de indisponibilidade", async () => {
    const { motivoIndisponivel } = await import("../../src/lib/recompensas");
    const agora = new Date("2026-10-27T12:00:00Z");
    expect(motivoIndisponivel({ ativo: true, disponivelAte: null, estoque: null }, agora)).toBeNull();
    expect(motivoIndisponivel({ ativo: false, disponivelAte: null, estoque: null }, agora)).toMatch(/indispon/i);
    expect(motivoIndisponivel({ ativo: true, disponivelAte: new Date("2026-10-01"), estoque: 5 }, agora)).toMatch(/encerrada/i);
    expect(motivoIndisponivel({ ativo: true, disponivelAte: null, estoque: 0 }, agora)).toMatch(/esgotada/i);
  });
  it("voucher ativo e vencido conta como expirado; os demais ficam como estão", async () => {
    const { statusVoucher } = await import("../../src/lib/recompensas");
    const agora = new Date("2026-10-27T12:00:00Z");
    expect(statusVoucher("ativo", new Date("2026-10-26"), agora)).toBe("expirado");
    expect(statusVoucher("ativo", new Date("2026-11-01"), agora)).toBe("ativo");
    expect(statusVoucher("utilizado", new Date("2026-10-26"), agora)).toBe("utilizado");
    expect(statusVoucher("cancelado", new Date("2026-10-26"), agora)).toBe("cancelado");
  });
  it("schema do catálogo recusa custo ≤ 0, nome curto e data inválida", async () => {
    const { recompensaCriar, recompensaAtualizar } = await import("../../src/lib/recompensas");
    expect(recompensaCriar.safeParse({ nome: "Caderno", custo: 1 }).success).toBe(true);
    expect(recompensaCriar.safeParse({ nome: "Caderno", custo: 0 }).success).toBe(false);
    expect(recompensaCriar.safeParse({ nome: "C", custo: 1 }).success).toBe(false);
    expect(recompensaCriar.safeParse({ nome: "Caderno", custo: 1, estoque: -1 }).success).toBe(false);
    expect(recompensaCriar.safeParse({ nome: "Caderno", custo: 1, disponivelAte: "não é data" }).success).toBe(false);
    expect(recompensaAtualizar.safeParse({}).success).toBe(false);
    expect(recompensaAtualizar.safeParse({ ativo: false }).success).toBe(true);
  });
});

describe("extrato: classificação das movimentações", () => {
  const base = { valor: 1, nomeLoja: null, materiaisDesc: "-", idQrTransacao: null };
  const fakeDb = (pix: unknown[] = [], vouchers: unknown[] = []) => ({ resgate: { findMany: async () => pix }, resgateRecompensa: { findMany: async () => vouchers } }) as never;
  it("reciclagem recente fica em carência; antiga fica concluída", async () => {
    const { anotarMovimentacoes } = await import("../../src/lib/extrato");
    const agora = new Date("2026-10-27T12:00:00Z");
    const r = await anotarMovimentacoes(fakeDb(), [
      { ...base, id: 1, tipo: "credito", categoria: "reciclagem", forma: "pix", criadoEm: new Date("2026-10-27T08:00:00Z") },
      { ...base, id: 2, tipo: "credito", categoria: "reciclagem", forma: "pix", criadoEm: new Date("2026-10-20T08:00:00Z") },
    ], 24, agora);
    expect(r[0].status).toBe("em_carencia");
    expect(r[0].disponivel_em).toBeInstanceOf(Date);
    expect(r[1].status).toBe("concluido");
  });
  it("PIX herda o status do pedido; voucher vencido vira expirado; estorno é estorno", async () => {
    const { anotarMovimentacoes } = await import("../../src/lib/extrato");
    const agora = new Date("2026-10-27T12:00:00Z");
    const r = await anotarMovimentacoes(
      fakeDb([{ idTransacao: 10, status: "aprovado" }], [{ idTransacao: 11, status: "ativo", expiraEm: new Date("2026-10-01") }]),
      [
        { ...base, id: 10, tipo: "debito", categoria: "resgate", forma: "pix", criadoEm: agora },
        { ...base, id: 11, tipo: "debito", categoria: "resgate", forma: "recompensa", criadoEm: agora },
        { ...base, id: 12, tipo: "credito", categoria: "resgate", forma: "estorno_recompensa", criadoEm: agora },
        { ...base, id: 13, tipo: "debito", categoria: "resgate", forma: "loja", criadoEm: agora },
      ], 24, agora);
    expect(r.map((x) => [x.tipo_operacao, x.status])).toEqual([["resgate_pix", "aprovado"], ["resgate_recompensa", "voucher_expirado"], ["estorno", "concluido"], ["desconto_loja", "concluido"]]);
  });
});
