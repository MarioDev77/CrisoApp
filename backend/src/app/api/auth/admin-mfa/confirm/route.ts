import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { decifrarSegredoTotp, novosCodigosRecuperacao, verificarTotp } from "@/lib/mfa";
import { respostaComSessao } from "@/lib/sessao";

const body = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Informe o código de 6 dígitos.") });
export const POST = api({ auth: ["admin"], body, limites: [{ nome: "admin-mfa-confirm", por: "usuario", max: 10, janelaSeg: 900 }] }, async ({ usuario, body }) => {
  const mfa = await prisma().adminMfa.findUnique({ where: { usuarioId: usuario.id } });
  if (!mfa || mfa.habilitado) throw new HttpError(409, "Inicie a configuração do segundo fator novamente.");
  if (!verificarTotp(decifrarSegredoTotp(mfa.segredoEnc), body.codigo)) throw new HttpError(400, "Código MFA incorreto.");
  const recovery = novosCodigosRecuperacao();
  await prisma().adminMfa.update({ where: { usuarioId: usuario.id }, data: { habilitado: true, recoveryHashes: recovery.hashes } });
  const admin = await prisma().usuario.findUniqueOrThrow({ where: { id: usuario.id }, select: { versaoSessao: true } });
  return respostaComSessao({ sucesso: true, mensagem: "Segundo fator ativado.", codigos_recuperacao: recovery.codes }, { id: usuario.id, tipo: "admin", versao: admin.versaoSessao, mfa: true });
});
