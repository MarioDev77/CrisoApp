import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { decifrarSegredoTotp, verificarTotp } from "@/lib/mfa";
import { buscarMfa, contaDoPerfil, substituirCodigosRecuperacao } from "@/lib/mfa-codigos";
import { respostaComSessao } from "@/lib/sessao";

const body = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Informe o código de 6 dígitos.") });
export const POST = api({ auth: ["cliente", "loja", "admin"], body, limites: [{ nome: "mfa-confirm", por: "usuario", max: 10, janelaSeg: 900 }] }, async ({ usuario, body }) => {
  const mfa = await buscarMfa(contaDoPerfil(usuario));
  if (!mfa || mfa.habilitado) throw new HttpError(409, "Inicie a configuração do segundo fator novamente.");
  if (!verificarTotp(decifrarSegredoTotp(mfa.segredoEnc), body.codigo)) throw new HttpError(400, "Código MFA incorreto.");
  const codigos = await substituirCodigosRecuperacao(mfa.id);
  await prisma().mfaConta.update({ where: { id: mfa.id }, data: { habilitado: true, recoveryHashes: [] } });
  const versao = usuario.tipo === "loja"
    ? (await prisma().loja.findUniqueOrThrow({ where: { id: usuario.id }, select: { versaoSessao: true } })).versaoSessao
    : (await prisma().usuario.findUniqueOrThrow({ where: { id: usuario.id }, select: { versaoSessao: true } })).versaoSessao;
  return respostaComSessao({ sucesso: true, mensagem: "Segundo fator ativado.", codigos_recuperacao: codigos }, { id: usuario.id, tipo: usuario.tipo, versao, mfa: true });
});
