// Log JSON estruturado. Nunca registre senhas, tokens, códigos OTP ou corpo de requisição.
const CAMPOS_PROIBIDOS = /senha|token|codigo|authorization|cookie|secret/i;
function limpar(o: Record<string, unknown>) {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) r[k] = CAMPOS_PROIBIDOS.test(k) ? "[omitido]" : v;
  return r;
}
const emit = (nivel: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), nivel, msg, ...limpar(extra) }));
export const log = {
  info: (m: string, e?: Record<string, unknown>) => emit("info", m, e),
  warn: (m: string, e?: Record<string, unknown>) => emit("warn", m, e),
  error: (m: string, e?: Record<string, unknown>) => emit("error", m, e),
};
