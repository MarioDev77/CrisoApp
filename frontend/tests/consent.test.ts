import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CATEGORIA_EM_USO, CONSENT_COOKIE, CONSENT_EVENT, POLICY_VERSION, aceitarTodos, carregarOpcional, novaEscolha,
  readConsent, rejeitarOpcionais, salvarConsentimento, serializarCookieConsent, temPermissao,
} from '../src/consent';

const SEM_RECARGA = { protocol: 'https:', reload: vi.fn() };
const apagarTudo = () => document.cookie.split('; ').forEach((c) => { const n = c.split('=')[0]; if (n) document.cookie = `${n}=; Max-Age=0; Path=/`; });
const gravarBruto = (obj: unknown) => { document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(obj))}; Path=/`; };
const emUso = { ...CATEGORIA_EM_USO };

beforeEach(() => { apagarTudo(); document.head.querySelectorAll('script').forEach((s) => s.remove()); SEM_RECARGA.reload.mockClear(); });
afterEach(() => { Object.assign(CATEGORIA_EM_USO, emUso); delete (window as unknown as { google?: unknown }).google; });

describe('cookies — escolha e persistência', () => {
  it('1. primeiro acesso: sem escolha válida (o banner deve aparecer)', () => { expect(readConsent()).toBeNull(); });

  it('2. rejeitar opcionais: tudo opcional bloqueado, necessários ativos, nada pré-selecionado', () => {
    salvarConsentimento(rejeitarOpcionais(), document, SEM_RECARGA);
    const c = readConsent()!;
    expect(c).toMatchObject({ version: 3, policyVersion: POLICY_VERSION, necessary: true, preferences: false, analytics: false, marketing: false, google: false });
    expect(novaEscolha({}).google).toBe(false);
  });

  it('3. aceitar todos: só liga o que existe de verdade (hoje nada opcional existe)', () => {
    salvarConsentimento(aceitarTodos(), document, SEM_RECARGA);
    const c = readConsent()!;
    expect([c.preferences, c.analytics, c.marketing, c.google]).toEqual([false, false, false, false]);
    expect(temPermissao('google')).toBe(false);
  });

  it('3b. com o Google em uso: aceitar todos liga só o Google; rejeitar desliga', () => {
    CATEGORIA_EM_USO.google = true;
    salvarConsentimento(aceitarTodos(), document, SEM_RECARGA);
    expect(readConsent()).toMatchObject({ google: true, analytics: false, marketing: false, preferences: false });
    salvarConsentimento(rejeitarOpcionais(), document, SEM_RECARGA);
    expect(readConsent()!.google).toBe(false);
  });

  it('4. personalizar: cada categoria em uso é independente; categoria sem integração não pode ser ligada', () => {
    CATEGORIA_EM_USO.google = true;
    salvarConsentimento(novaEscolha({ google: true, analytics: true, marketing: true }), document, SEM_RECARGA);
    expect(readConsent()).toMatchObject({ google: true, analytics: false, marketing: false });
  });

  it('5. fechar e reabrir o navegador: a escolha vem só do cookie (nada em memória)', () => {
    CATEGORIA_EM_USO.google = true;
    salvarConsentimento(novaEscolha({ google: true }), document, SEM_RECARGA);
    const guardado = document.cookie; // o que sobrevive ao fechar o navegador
    expect(guardado).toContain(CONSENT_COOKIE);
    expect(readConsent()).toMatchObject({ google: true });
  });

  it('6. atributos do cookie: 180 dias, Path=/, SameSite=Lax, Secure em HTTPS, sem Domain, sem dado pessoal', () => {
    const p = rejeitarOpcionais();
    const https = serializarCookieConsent(p, true);
    expect(https).toContain('Max-Age=15552000');
    expect(https).toContain('Path=/'); expect(https).toContain('SameSite=Lax'); expect(https).toContain('Secure');
    expect(https).not.toMatch(/Domain=/i);
    expect(serializarCookieConsent(p, false)).not.toContain('Secure');
    expect(Object.keys(p).sort()).toEqual(['analytics', 'google', 'marketing', 'necessary', 'offered', 'policyVersion', 'preferences', 'updatedAt', 'version']);
    expect(Object.values(p).join('|')).not.toMatch(/@|senha|token|cpf/i);
  });

  it('7. alterar preferências substitui a escolha anterior', () => {
    CATEGORIA_EM_USO.google = true;
    salvarConsentimento(novaEscolha({ google: true }), document, SEM_RECARGA);
    salvarConsentimento(novaEscolha({ google: false }), document, SEM_RECARGA);
    expect(readConsent()!.google).toBe(false);
  });

  it('8. revogar: apaga g_state próprio, remove o script, recarrega a página e avisa a interface', () => {
    CATEGORIA_EM_USO.google = true;
    salvarConsentimento(novaEscolha({ google: true }), document, SEM_RECARGA);
    document.cookie = 'g_state={"i_l":0}; Path=/';
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.dataset.cvOpcional = 'google'; document.head.append(s);
    (window as unknown as { google: unknown }).google = { accounts: { id: {} } };
    const ouviu = vi.fn(); window.addEventListener(CONSENT_EVENT, ouviu);
    salvarConsentimento(rejeitarOpcionais(), document, SEM_RECARGA);
    window.removeEventListener(CONSENT_EVENT, ouviu);
    expect(document.cookie).not.toContain('g_state');
    expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();
    expect(SEM_RECARGA.reload).toHaveBeenCalledTimes(1);
    expect(ouviu).toHaveBeenCalled();
    expect(temPermissao('google')).toBe(false);
  });

  it('8b. salvar sem ter Google carregado não recarrega a página à toa', () => {
    salvarConsentimento(rejeitarOpcionais(), document, SEM_RECARGA);
    expect(SEM_RECARGA.reload).not.toHaveBeenCalled();
  });
});

describe('cookies — invalidação da escolha', () => {
  it('9a. mudou a versão da política: escolha antiga deixa de valer', () => {
    gravarBruto({ ...rejeitarOpcionais(), policyVersion: '2.9' });
    expect(readConsent()).toBeNull();
  });
  it('9b. formato antigo (v2) é ignorado e o banner volta', () => {
    gravarBruto({ v: 2, google: true, updatedAt: new Date().toISOString() });
    expect(readConsent()).toBeNull();
  });
  it('9c. cookie corrompido ou adulterado é ignorado', () => {
    document.cookie = `${CONSENT_COOKIE}=%7Bnao-e-json; Path=/`;
    expect(readConsent()).toBeNull();
    gravarBruto({ ...rejeitarOpcionais(), necessary: false });
    expect(readConsent()).toBeNull();
    gravarBruto({ ...rejeitarOpcionais(), analytics: 'sim' });
    expect(readConsent()).toBeNull();
  });
  it('9d. mudou a finalidade (categoria nova passou a existir): pede a escolha de novo', () => {
    salvarConsentimento(rejeitarOpcionais(), document, SEM_RECARGA);
    expect(readConsent()).not.toBeNull();
    CATEGORIA_EM_USO.google = true; // o Google foi reativado depois da escolha
    expect(readConsent()).toBeNull();
  });
  it('9e. valor adulterado à mão para ligar categoria inexistente não vira permissão', () => {
    gravarBruto({ ...rejeitarOpcionais(), analytics: true, marketing: true });
    expect(readConsent()).toMatchObject({ analytics: false, marketing: false });
  });
});

describe('bloqueio real dos rastreadores', () => {
  it('10a. com o login Google desativado nada é carregado, nem com cookie dizendo google:true', async () => {
    gravarBruto({ ...rejeitarOpcionais(), google: true });
    expect(await carregarOpcional('google')).toBe(false);
    expect(document.querySelector('script')).toBeNull();
  });
  it('10b. Google em uso, mas sem permissão: nenhum script é inserido', async () => {
    CATEGORIA_EM_USO.google = true;
    salvarConsentimento(rejeitarOpcionais(), document, SEM_RECARGA);
    expect(await carregarOpcional('google')).toBe(false);
    expect(document.querySelector('script')).toBeNull();
  });
  it('10c. Google em uso e permitido: o script entra (e só então)', async () => {
    CATEGORIA_EM_USO.google = true;
    salvarConsentimento(novaEscolha({ google: true }), document, SEM_RECARGA);
    const promessa = carregarOpcional('google');
    const s = document.querySelector('script[src="https://accounts.google.com/gsi/client"]') as HTMLScriptElement;
    expect(s).not.toBeNull();
    s.onerror?.(new Event('error')); // jsdom não baixa scripts; simula falha de rede
    expect(await promessa).toBe(false);
  });
  it('10d. categorias sem integração nunca carregam nada', async () => {
    CATEGORIA_EM_USO.analytics = true; // mesmo "em uso", não existe integração real implementada
    salvarConsentimento(novaEscolha({ analytics: true }), document, SEM_RECARGA);
    expect(await carregarOpcional('analytics')).toBe(false);
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('o app não conecta a terceiros por conta própria', () => {
  const raiz = resolve(__dirname, '..');
  it('index.html não tem script, preconnect, preload nem stylesheet externos', () => {
    const html = readFileSync(resolve(raiz, 'index.html'), 'utf8');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
  it('a CSP da Vercel não libera Google Fonts', () => {
    const v = readFileSync(resolve(raiz, 'vercel.json'), 'utf8');
    expect(v).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
  it('o único lugar que referencia o script do Google é o carregador condicionado', () => {
    const app = readFileSync(resolve(raiz, 'src/App.tsx'), 'utf8');
    const consent = readFileSync(resolve(raiz, 'src/consent.ts'), 'utf8');
    expect(app).not.toContain('accounts.google.com/gsi');
    expect(consent.match(/accounts\.google\.com\/gsi\/client/g)?.length).toBeGreaterThanOrEqual(1);
  });
});
