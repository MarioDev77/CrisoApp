export function dadosVinculoGoogle(
  existente: { senha: string | null; emailVerificado: boolean },
  googleId: string,
  foto: string | null,
) {
  const invalidarSenhaAnterior = Boolean(existente.senha) && !existente.emailVerificado;
  return {
    provider: "google" as const,
    googleId,
    foto,
    emailVerificado: true,
    ultimoLogin: new Date(),
    ...(invalidarSenhaAnterior ? { senha: null, versaoSessao: { increment: 1 } } : {}),
  };
}
