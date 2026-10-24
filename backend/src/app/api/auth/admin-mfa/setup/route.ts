import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/errors";
import { env } from "@/lib/env";
import { base32, cifrarSegredoTotp, novoSegredoTotp } from "@/lib/mfa";

export const POST = api({ auth: ["admin"], limites: [{ nome: "admin-mfa-setup", por: "usuario", max: 5, janelaSeg: 900 }] }, async ({ usuario }) => {
  if (!env().DATA_ENCRYPTION_KEYS || !env().BLIND_INDEX_KEY) throw new HttpError(503, "Criptografia de MFA ainda não configurada no servidor.");
  const existente = await prisma().adminMfa.findUnique({ where: { usuarioId: usuario.id } });
  if (existente?.habilitado) throw new HttpError(409, "Segundo fator já configurado.");
  const secret = base32(novoSegredoTotp());
  await prisma().adminMfa.upsert({
    where: { usuarioId: usuario.id },
    create: { usuarioId: usuario.id, segredoEnc: cifrarSegredoTotp(secret), habilitado: false },
    update: { segredoEnc: cifrarSegredoTotp(secret), habilitado: false, recoveryHashes: [] },
  });
  const label = encodeURIComponent(`CrisoVerde:${usuario.email}`);
  const issuer = encodeURIComponent("CrisoVerde");
  return { sucesso: true, secret, otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
});
