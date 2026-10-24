import { cifrar, decifrarOpt, hashEmail, hashTelefone, hashTokenQr, indiceCego, normalizarEmail, normalizarTelefone } from "./crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

const criptoAtiva = () => Boolean(env().DATA_ENCRYPTION_KEYS && env().BLIND_INDEX_KEY);

type UsuarioPII = { email: string; emailEnc?: string | null; telefone?: string; telefoneEnc?: string | null };
type LojaPII = { email: string; emailEnc?: string | null; telefone: string; telefoneEnc?: string | null; endereco: string | null; enderecoEnc?: string | null; responsavel: string; responsavelEnc?: string | null };

export const emailDoUsuario = (u: UsuarioPII) => decifrarOpt(u.emailEnc, "usuarios.email") ?? u.email;
export const telefoneDoUsuario = (u: UsuarioPII) => decifrarOpt(u.telefoneEnc, "usuarios.telefone") ?? u.telefone ?? "";
export const emailDaLoja = (l: LojaPII) => decifrarOpt(l.emailEnc, "lojas.email") ?? l.email;
export const telefoneDaLoja = (l: LojaPII) => decifrarOpt(l.telefoneEnc, "lojas.telefone") ?? l.telefone;
export const enderecoDaLoja = (l: LojaPII) => decifrarOpt(l.enderecoEnc, "lojas.endereco") ?? l.endereco;
export const responsavelDaLoja = (l: LojaPII) => decifrarOpt(l.responsavelEnc, "lojas.responsavel") ?? l.responsavel;

export function camposEmailUsuario(email: string) {
  const n = normalizarEmail(email);
  return { email: n, emailEnc: criptoAtiva() ? cifrar(n, "usuarios.email") : null, emailHash: criptoAtiva() ? hashEmail(n) : null };
}
export function camposEmailLoja(email: string) {
  const n = normalizarEmail(email);
  return { email: n, emailEnc: criptoAtiva() ? cifrar(n, "lojas.email") : null, emailHash: criptoAtiva() ? hashEmail(n) : null };
}
export function camposTelefoneUsuario(telefone: string) {
  const n = normalizarTelefone(telefone);
  return { telefone: n, telefoneEnc: n && criptoAtiva() ? cifrar(n, "usuarios.telefone") : null, telefoneHash: n && criptoAtiva() ? hashTelefone(n) : null };
}
export function camposTelefoneLoja(telefone: string) {
  const n = normalizarTelefone(telefone);
  return { telefone: n, telefoneEnc: n && criptoAtiva() ? cifrar(n, "lojas.telefone") : null, telefoneHash: n && criptoAtiva() ? hashTelefone(n) : null };
}
export const camposEnderecoLoja = (endereco: string | null | undefined) => ({
  endereco: endereco || null,
  enderecoEnc: endereco && criptoAtiva() ? cifrar(endereco, "lojas.endereco") : null,
});
export const camposResponsavelLoja = (responsavel: string) => ({
  responsavel,
  responsavelEnc: criptoAtiva() ? cifrar(responsavel, "lojas.responsavel") : null,
});
export const hashGoogleId = (id: string) => criptoAtiva() ? indiceCego(id, "usuarios.google_id") : null;
export async function buscarUsuarioPorGoogleId(db: Db, id: string) {
  const hash = hashGoogleId(id);
  return hash ? db.usuario.findFirst({ where: { OR: [{ googleIdHash: hash }, { googleId: id }] } }) : db.usuario.findUnique({ where: { googleId: id } });
}

export function camposQrCode(token: string, ip: string, dados: { valor: number; materiais?: unknown; materiaisDesc: string; produto?: string | null }) {
  return {
    tokenHash: criptoAtiva() ? hashTokenQr(token) : null,
    dadosEnc: criptoAtiva() ? cifrar(JSON.stringify(dados), "qr_codes.dados") : null,
    ipEnc: criptoAtiva() && ip && ip !== "desconhecido" ? cifrar(ip, "qr_codes.ip_gerado") : null,
  };
}
export const tokenHashQr = (token: string) => criptoAtiva() ? hashTokenQr(token) : null;
export const ipDoQr = (qr: { ipEnc?: string | null; ipGerado?: string | null }) => decifrarOpt(qr.ipEnc, "qr_codes.ip_gerado") ?? qr.ipGerado ?? null;
export function decifrarDadosQr(qr: { dadosEnc?: string | null; valor: unknown; materiais: unknown; materiaisDesc: string; produto?: string | null }) {
  if (!qr.dadosEnc) return { valor: qr.valor, materiais: qr.materiais, materiaisDesc: qr.materiaisDesc, produto: qr.produto ?? null };
  return JSON.parse(decifrarOpt(qr.dadosEnc, "qr_codes.dados")!) as { valor: unknown; materiais: unknown; materiaisDesc: string; produto: string | null };
}

type Db = Prisma.TransactionClient | PrismaClient;
export async function buscarUsuarioPorEmail(db: Db, email: string) {
  const normalized = normalizarEmail(email);
  return criptoAtiva()
    ? db.usuario.findFirst({ where: { OR: [{ emailHash: hashEmail(normalized) }, { email: normalized }] } })
    : db.usuario.findUnique({ where: { email: normalized } });
}

export async function buscarLojaPorEmail(db: Db, email: string) {
  const normalized = normalizarEmail(email);
  return criptoAtiva()
    ? db.loja.findFirst({ where: { OR: [{ emailHash: hashEmail(normalized) }, { email: normalized }] } })
    : db.loja.findUnique({ where: { email: normalized } });
}
