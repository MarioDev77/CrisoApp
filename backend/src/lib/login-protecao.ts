import { HttpError } from "./errors";
import { contar, estenderJanela, estornar, zerar, type Regra } from "./rate-limit";
import { log } from "./log";

/**
 * Proteção de login. Princípios:
 *  1) Só FALHAS reais gastam o orçamento: a tentativa é reservada de forma atômica (impede rajadas paralelas)
 *     e devolvida quando o login dá certo ou quando era só o pedido do código MFA.
 *  2) Quem erra a senha de outra pessoa gasta o PRÓPRIO orçamento (IP + e-mail), não o da vítima.
 *  3) Contenção por conta, progressiva (15 min → 30 min → ... → 4 h): a conta sob ataque só deixa de aceitar
 *     tentativas de quem NÃO tem o cookie de dispositivo conhecido. O dono no navegador de sempre continua entrando.
 *  4) Sem IP confiável, os limites por IP e IP+e-mail são desligados (seriam um balde global): a conta fica
 *     protegida só pela contenção por conta, e a rota emite alerta operacional.
 */
export const LIMITES_LOGIN = {
  ipFalha: { nome: "login-falha-ip", max: 40, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." } satisfies Regra,
  ipEmail: { nome: "login-falha", max: 8, janelaSeg: 900, msg: "Muitas tentativas. Tente novamente em 15 minutos." } satisfies Regra,
  conta: { nome: "login-conta", limiar: 15, tetoComDispositivo: 100, janelaSeg: 900 },
  nivel: { nome: "login-nivel", janelaSeg: 86_400 },
} as const;
const BASE_SEG = 900;
const TETO_SEG = 4 * 3600;
export const duracaoContencao = (nivel: number) => Math.min(BASE_SEG * 2 ** Math.max(0, nivel - 1), TETO_SEG);

export type ReservaLogin = {
  /** Login concluído: não conta como falha e libera o contador de IP+e-mail. */
  sucesso(): Promise<void>;
  /** A tentativa foi só o pedido do código MFA (nada foi adivinhado): devolve o que foi reservado. */
  devolver(): Promise<void>;
};

export async function reservarTentativaLogin(a: { ip: string; ipConfiavel: boolean; email: string; dispositivoConhecido: boolean }): Promise<ReservaLogin> {
  const email = a.email.trim().toLowerCase();
  const usarIp = a.ipConfiavel;
  const idIpEmail = `${a.ip}|${email}`;
  const C = LIMITES_LOGIN.conta;

  if (usarIp) {
    const f = await contar(LIMITES_LOGIN.ipFalha, a.ip);
    if (f.contagem > LIMITES_LOGIN.ipFalha.max) throw new HttpError(429, LIMITES_LOGIN.ipFalha.msg, { retryAfter: f.ttl });
    const fe = await contar(LIMITES_LOGIN.ipEmail, idIpEmail);
    if (fe.contagem > LIMITES_LOGIN.ipEmail.max) throw new HttpError(429, LIMITES_LOGIN.ipEmail.msg, { retryAfter: fe.ttl });
  }

  const c = await contar(C, email);
  if (c.contagem > C.limiar) {
    const teto = a.dispositivoConhecido && c.contagem <= C.tetoComDispositivo;
    if (!teto) {
      // Primeira tentativa acima do limiar nesta janela: sobe o nível e prolonga o bloqueio (progressivo).
      let ttl = c.ttl;
      if (c.contagem === C.limiar + 1) {
        const n = await contar(LIMITES_LOGIN.nivel, email);
        ttl = await estenderJanela(C, email, duracaoContencao(n.contagem));
        log.warn("conta_sob_ataque", { nivel: n.contagem, bloqueio_seg: ttl, ip_confiavel: usarIp });
      }
      throw new HttpError(429, "Muitas tentativas para esta conta. Se for você, tente no aparelho de sempre ou use \"Esqueci a senha\".", { retryAfter: ttl });
    }
  }

  const desfazer = async () => {
    await estornar(C, email);
    if (usarIp) { await estornar(LIMITES_LOGIN.ipFalha, a.ip); await estornar(LIMITES_LOGIN.ipEmail, idIpEmail); }
  };
  return {
    async sucesso() {
      await estornar(C, email);
      if (usarIp) { await estornar(LIMITES_LOGIN.ipFalha, a.ip); await zerar(LIMITES_LOGIN.ipEmail, idIpEmail); }
    },
    devolver: desfazer,
  };
}
