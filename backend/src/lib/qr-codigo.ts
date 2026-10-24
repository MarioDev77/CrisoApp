import { randomInt } from "node:crypto";

/**
 * Código curto do QR: alternativa digitável quando a câmera do celular não abre.
 * Alfabeto sem I, L, O, 0 e 1 (confundem-se na digitação). 8 caracteres = 31^8 ≈ 8,5 × 10^11 combinações,
 * o QR vale no máximo 60 s e a validação tem limite de tentativas por usuário.
 */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TAMANHO_CODIGO = 8;
const FORMATO = new RegExp(`^[${ALFABETO}]{${TAMANHO_CODIGO}}$`);

export function novoCodigoCurto(): string {
  let c = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) c += ALFABETO[randomInt(ALFABETO.length)];
  return c;
}

/** "K7M2-9QXA" para exibir. */
export const formatarCodigo = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** Se o texto digitado é um código curto (com ou sem hífen/espaço, qualquer caixa), devolve-o normalizado; senão null. */
export function codigoCurtoDe(texto: string): string | null {
  const limpo = texto.toUpperCase().replace(/[\s-]/g, "");
  return FORMATO.test(limpo) ? limpo : null;
}
