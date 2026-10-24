import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const email = z.string({ error: "Informe o e-mail" }).trim().toLowerCase().max(255).regex(EMAIL_RE, "E-mail inválido");
export const senhaNova = z
  .string({ error: "Informe a senha" })
  .min(8, "Senha deve ter no mínimo 8 caracteres")
  .max(72, "Senha muito longa (máximo 72 caracteres)")
  .regex(/(?=.*[a-zA-Z])(?=.*[0-9])/, "Senha deve conter letras e números");
export const idParam = z.coerce.number({ error: "ID inválido" }).int("ID inválido").positive("ID inválido").max(2_147_483_647, "ID inválido");
export const paginacao = {
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
};
export const mesYYYYMM = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido (use AAAA-MM)");
