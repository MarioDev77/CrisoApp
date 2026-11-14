import { describe, it, expect, vi } from "vitest";
import { vinculoQr } from "../../src/lib/qr-vinculo";
import { emailVerificadoOuErro } from "../../src/lib/perfil";

vi.mock("../../src/lib/db", () => ({ prisma: () => ({}) }));
const { descreverMudanca } = await import("../../src/lib/auditoria-admin");

describe("vínculo do QR", () => {
  it("livre / meu / outro", () => {
    expect(vinculoQr(null, 5)).toBe("livre");
    expect(vinculoQr(undefined, 5)).toBe("livre");
    expect(vinculoQr(5, 5)).toBe("meu");
    expect(vinculoQr(6, 5)).toBe("outro");
  });
});

describe("e-mail verificado", () => {
  it("só barra quando a exigência está ligada e o e-mail não foi confirmado", () => {
    expect(emailVerificadoOuErro({ emailVerificado: false }, false)).toEqual({ ok: true });
    expect(emailVerificadoOuErro({ emailVerificado: true }, true)).toEqual({ ok: true });
    expect(emailVerificadoOuErro({ emailVerificado: false }, true)).toMatchObject({ ok: false });
  });
});

describe("auditoria antes → depois", () => {
  it("lista só o que mudou, em ordem estável", () => {
    expect(descreverMudanca({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, c: 3 })).toBe("b: 2 → 5");
    expect(descreverMudanca({ z: 1, a: 1 }, { z: 2, a: 2 })).toBe("a: 1 → 2; z: 1 → 2");
  });
  it("configuração nova (sem valor anterior) mostra ∅ → valor; sem mudança diz isso", () => {
    expect(descreverMudanca(null, { kg: 50 })).toBe("kg: ∅ → 50");
    expect(descreverMudanca({ kg: 50 }, { kg: 50 })).toBe("sem alteração de valores");
  });
  it("campo removido aparece como ∅ e valores longos são truncados", () => {
    expect(descreverMudanca({ x: 1 }, {})).toBe("x: 1 → ∅");
    expect(descreverMudanca({ t: "a" }, { t: "b".repeat(300) }).length).toBeLessThan(160);
  });
});
