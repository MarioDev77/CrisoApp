import { describe, expect, it } from "vitest";
import { codigoCurtoDe, formatarCodigo, novoCodigoCurto, TAMANHO_CODIGO } from "../../src/lib/qr-codigo";
describe("código curto do QR", () => {
  it("gera 8 caracteres só do alfabeto sem ambíguos e todos reconhecidos", () => {
    for (let i = 0; i < 500; i++) { const c = novoCodigoCurto(); expect(c).toHaveLength(TAMANHO_CODIGO); expect(c).toMatch(/^[A-HJKMNP-Z2-9]+$/); expect(codigoCurtoDe(formatarCodigo(c))).toBe(c); }
  });
  it("aceita minúsculas, hífen e espaços", () => { expect(codigoCurtoDe(" k7m2-9qxa ")).toBe("K7M29QXA"); expect(codigoCurtoDe("k7m2 9qxa")).toBe("K7M29QXA"); });
  it("não confunde token UUID nem texto inválido com código curto", () => {
    expect(codigoCurtoDe("3f2b8c1e-9d4a-4e7b-8a21-5c6d7e8f9a0b")).toBeNull();
    expect(codigoCurtoDe("K7M2-9QX")).toBeNull(); expect(codigoCurtoDe("K7M2-9QXAA")).toBeNull(); expect(codigoCurtoDe("K7M2-9QX0")).toBeNull(); expect(codigoCurtoDe("")).toBeNull();
  });
});
