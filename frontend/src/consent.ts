// Consentimento de cookies (LGPD) — lógica pura, sem React, para poder ser testada.
//
// Regra de ouro: nenhuma tecnologia opcional é carregada sem a permissão da categoria dela.
// Toda carga de recurso opcional passa por `carregarOpcional()`, que consulta o consentimento ATUAL.

export type OptionalCategory = 'preferences' | 'analytics' | 'marketing' | 'google';

export type ConsentPrefs = {
  version: 3;
  policyVersion: string;
  necessary: true;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
  google: boolean;
  /** Categorias opcionais que estavam em uso (e foram mostradas à pessoa) quando ela decidiu. */
  offered: OptionalCategory[];
  updatedAt: string;
};

export const CONSENT_COOKIE = 'cv_cookie_consent';
export const CONSENT_VERSION = 3 as const;
export const POLICY_VERSION = '3.0';
export const POLICY_DATE = '10/11/2026';
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const CONSENT_EVENT = 'cookie-consent-updated';
export const OPEN_SETTINGS_EVENT = 'open-cookie-settings';

// Login com Google desativado. Para reativar: trocar para true aqui e ligar GOOGLE_LOGIN_ATIVO=true no backend.
export const GOOGLE_LOGIN_ATIVO: boolean = false;

/**
 * Categorias que têm integração REAL no código. Só elas mostram controle ativo e entram em "Aceitar todos".
 * Não invente entradas aqui: marcar `true` sem uma integração de verdade seria declarar algo falso.
 * Ao instalar um analytics, por exemplo: `analytics: true`, subir POLICY_VERSION e ligar o carregador abaixo.
 */
export const CATEGORIA_EM_USO: Record<OptionalCategory, boolean> = {
  preferences: false, // o app não guarda nenhuma personalização opcional no navegador
  analytics: false,   // nenhuma ferramenta de análise instalada
  marketing: false,   // nenhuma publicidade/rastreamento instalado
  google: GOOGLE_LOGIN_ATIVO,
};

export const OPTIONAL_CATEGORIES: OptionalCategory[] = ['preferences', 'analytics', 'marketing', 'google'];

/** Cookies PRÓPRIOS (mesmo domínio) que cada categoria pode criar e que sabemos apagar. */
export const COOKIES_POR_CATEGORIA: Record<OptionalCategory, string[]> = {
  preferences: [],
  analytics: [],
  marketing: [],
  google: ['g_state'], // criado pelo script do Google no NOSSO domínio; os do domínio google.com o navegador não deixa apagar
};

export const categoriasEmUso = (): OptionalCategory[] => OPTIONAL_CATEGORIES.filter((c) => CATEGORIA_EM_USO[c]);

// ---- cookie ----------------------------------------------------------------------------

export function readCookie(name: string, doc: Pick<Document, 'cookie'> = document): string {
  const par = doc.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return par ? par.split('=').slice(1).join('=') : '';
}

function validar(bruto: unknown): ConsentPrefs | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const p = bruto as Record<string, unknown>;
  if (p.version !== CONSENT_VERSION || p.policyVersion !== POLICY_VERSION || p.necessary !== true) return null;
  if (!OPTIONAL_CATEGORIES.every((c) => typeof p[c] === 'boolean')) return null;
  if (!Array.isArray(p.offered) || !p.offered.every((c) => OPTIONAL_CATEGORIES.includes(c as OptionalCategory))) return null;
  // Alteração de finalidade: surgiu uma categoria em uso que a pessoa nunca viu → a escolha antiga não vale mais.
  const vistas = p.offered as OptionalCategory[];
  if (categoriasEmUso().some((c) => !vistas.includes(c))) return null;
  // Permissão só pode existir para categoria em uso (ignora valores adulterados à mão).
  const limpo: ConsentPrefs = {
    version: CONSENT_VERSION,
    policyVersion: POLICY_VERSION,
    necessary: true,
    preferences: p.preferences === true && CATEGORIA_EM_USO.preferences,
    analytics: p.analytics === true && CATEGORIA_EM_USO.analytics,
    marketing: p.marketing === true && CATEGORIA_EM_USO.marketing,
    google: p.google === true && CATEGORIA_EM_USO.google,
    offered: vistas,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt.slice(0, 40) : '',
  };
  return limpo;
}

/** Lê a escolha. `null` = não há escolha válida (primeiro acesso, versão antiga, política mudou, cookie corrompido). */
export function readConsent(doc: Pick<Document, 'cookie'> = document): ConsentPrefs | null {
  const raw = readCookie(CONSENT_COOKIE, doc);
  if (!raw) return null;
  try { return validar(JSON.parse(decodeURIComponent(raw))); } catch { return null; }
}

/** Monta a string do cookie. Sem `Domain` (host-only), Path=/, SameSite=Lax, Secure em HTTPS, 180 dias. */
export function serializarCookieConsent(prefs: ConsentPrefs, https: boolean): string {
  return `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(prefs))}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${https ? '; Secure' : ''}`;
}

export function novaEscolha(valores: Partial<Record<OptionalCategory, boolean>>): ConsentPrefs {
  const v = (c: OptionalCategory) => CATEGORIA_EM_USO[c] && valores[c] === true;
  return {
    version: CONSENT_VERSION,
    policyVersion: POLICY_VERSION,
    necessary: true,
    preferences: v('preferences'),
    analytics: v('analytics'),
    marketing: v('marketing'),
    google: v('google'),
    offered: categoriasEmUso(),
    updatedAt: new Date().toISOString(),
  };
}

export const aceitarTodos = () => novaEscolha(Object.fromEntries(categoriasEmUso().map((c) => [c, true])));
export const rejeitarOpcionais = () => novaEscolha({});

function apagarCookiePropio(nome: string, https: boolean, doc: Pick<Document, 'cookie'>) {
  doc.cookie = `${nome}=; Max-Age=0; Path=/; SameSite=Lax${https ? '; Secure' : ''}`;
}

/** Remove da página o que uma categoria revogada carregou. Retorna se é preciso recarregar para descarregar scripts. */
function desfazerCategoria(c: OptionalCategory, https: boolean, doc: Document): boolean {
  COOKIES_POR_CATEGORIA[c].forEach((n) => apagarCookiePropio(n, https, doc));
  let recarregar = false;
  if (c === 'google') {
    const scripts = doc.querySelectorAll('script[data-cv-opcional="google"], script[src*="accounts.google.com/gsi"]');
    scripts.forEach((s) => { s.remove(); recarregar = true; });
    // Um script já executado não se "descarrega" de verdade; recarregar a página é a única forma honesta.
    if ((window as unknown as { google?: unknown }).google) recarregar = true;
  }
  return recarregar;
}

/**
 * Grava a escolha, apaga o que for revogado e avisa a interface.
 * Não afirma apagar cookies de domínios externos: o navegador não permite.
 */
export function salvarConsentimento(prefs: ConsentPrefs, doc: Document = document, loc: Pick<Location, 'protocol' | 'reload'> = location): void {
  const https = loc.protocol === 'https:';
  const anterior = readConsent(doc);
  doc.cookie = serializarCookieConsent(prefs, https);
  let recarregar = false;
  for (const c of OPTIONAL_CATEGORIES) {
    const tinha = anterior ? anterior[c] : false;
    // Revogou agora OU nunca teve permissão mas há resquício carregado: limpa em ambos os casos.
    if (!prefs[c] && (tinha || c === 'google')) recarregar = desfazerCategoria(c, https, doc) || recarregar;
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
  if (recarregar) loc.reload();
}

export const temPermissao = (c: OptionalCategory, doc: Pick<Document, 'cookie'> = document): boolean => readConsent(doc)?.[c] === true;

// ---- carregamento condicionado ---------------------------------------------------------

const URL_GSI = 'https://accounts.google.com/gsi/client';

/**
 * Único ponto que injeta recursos de terceiros opcionais. Recusa se a categoria não está em uso
 * ou se não há permissão vigente. Retorna `true` se o recurso está disponível.
 */
export async function carregarOpcional(c: OptionalCategory, doc: Document = document): Promise<boolean> {
  if (!CATEGORIA_EM_USO[c] || !temPermissao(c, doc)) return false;
  if (c !== 'google') return false; // não existe integração real para as demais categorias
  const w = window as unknown as { google?: { accounts?: { id?: unknown } } };
  if (w.google?.accounts?.id) return true;
  await new Promise<void>((resolve) => {
    const s = doc.createElement('script');
    s.src = URL_GSI; s.async = true; s.dataset.cvOpcional = 'google';
    s.onload = () => resolve(); s.onerror = () => resolve();
    doc.head.append(s);
  });
  return Boolean(w.google?.accounts?.id);
}

// ---- texto das categorias (usado no modal e na política) -------------------------------

export type CategoriaInfo = {
  id: 'necessary' | OptionalCategory;
  nome: string;
  descricao: string;
  finalidade: string;
  tecnologias: string;
  prazo: string;
};

export const CATEGORIAS: CategoriaInfo[] = [
  { id: 'necessary', nome: 'Necessários', descricao: 'Fazem o aplicativo funcionar e protegem sua conta. Não podem ser desativados.', finalidade: 'Autenticação, segurança, manutenção da sessão e memória da sua escolha de cookies.', tecnologias: '__Host-crisoverde_session (sessão; HttpOnly, Secure, SameSite=Strict) e cv_cookie_consent (sua escolha).', prazo: 'Sessão: 8 horas. Escolha de cookies: 180 dias.' },
  { id: 'preferences', nome: 'Preferências', descricao: 'Lembrariam personalizações da experiência que não são essenciais.', finalidade: 'Guardar ajustes opcionais de uso neste aparelho.', tecnologias: 'Nenhuma. O CrisoVerde não guarda personalizações no seu navegador.', prazo: 'Não se aplica.' },
  { id: 'analytics', nome: 'Estatísticas', descricao: 'Medem desempenho e uso do aplicativo.', finalidade: 'Análise de utilização e métricas de navegação.', tecnologias: 'Nenhuma. Não há ferramenta de análise instalada.', prazo: 'Não se aplica.' },
  { id: 'marketing', nome: 'Marketing', descricao: 'Serviriam a publicidade e a rastreamento publicitário.', finalidade: 'Anúncios e integrações de marketing.', tecnologias: 'Nenhuma. Não há publicidade nem rastreador instalado.', prazo: 'Não se aplica.' },
  { id: 'google', nome: 'Serviços externos: login com Google', descricao: 'Carrega o botão de login do Google (accounts.google.com). O Google pode definir cookies e tratar seu IP e dados do navegador conforme a política dele.', finalidade: 'Entrar no CrisoVerde com a conta Google.', tecnologias: 'Script do Google Identity Services e o cookie g_state no nosso domínio. Cookies do próprio Google ficam sob o controle dele.', prazo: 'g_state: definido pelo Google. Removemos o g_state do nosso domínio ao retirar a permissão.' },
];
