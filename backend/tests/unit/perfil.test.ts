import { describe, expect, it } from "vitest";
import { perfilCompleto } from "@/lib/perfil";

const base = { nome: "Maria Silva", email: "maria@exemplo.com", telefone: "75999998888" };

describe("perfilCompleto", () => {
  it("aceita nome, e-mail e celular válidos", () => {
    expect(perfilCompleto(base)).toBe(true);
    expect(perfilCompleto({ ...base, telefone: "(75) 99999-8888" })).toBe(true);
  });
  it("exige celular", () => {
    expect(perfilCompleto({ ...base, telefone: "" })).toBe(false);
    expect(perfilCompleto({ ...base, telefone: "12345" })).toBe(false);
  });
  it("exige e-mail válido", () => {
    expect(perfilCompleto({ ...base, email: "" })).toBe(false);
    expect(perfilCompleto({ ...base, email: "sem-arroba" })).toBe(false);
  });
  it("exige nome", () => {
    expect(perfilCompleto({ ...base, nome: "  " })).toBe(false);
  });
});
