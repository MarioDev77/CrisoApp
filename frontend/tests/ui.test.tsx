import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CookieConsent, PrivacyPage } from '../src/App';
import { CATEGORIA_EM_USO, CONSENT_COOKIE, OPEN_SETTINGS_EVENT, readConsent } from '../src/consent';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const limpar = () => document.cookie.split('; ').forEach((c) => { const n = c.split('=')[0]; if (n) document.cookie = `${n}=; Max-Age=0; Path=/`; });
const montar = async (ui: React.ReactElement) => { await act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>); }); };
const botoes = () => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim());
const clicar = async (texto: string) => { const b = [...host.querySelectorAll('button')].find((x) => x.textContent?.trim() === texto)!; await act(async () => { b.click(); }); };

beforeEach(() => { limpar(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
const emUso = { ...CATEGORIA_EM_USO };
afterEach(() => { act(() => root.unmount()); host.remove(); Object.assign(CATEGORIA_EM_USO, emUso); });

describe('banner e modal', () => {
  it('primeiro acesso: banner com as 3 ações, sem "Entendi", com link para a política', async () => {
    await montar(<CookieConsent />);
    expect(host.querySelector('.cookie-banner')).not.toBeNull();
    expect(botoes()).toEqual(['Aceitar todos', 'Rejeitar opcionais', 'Personalizar preferências']);
    expect(botoes()).not.toContain('Entendi');
    expect(host.querySelector('a[href="/privacidade"]')).not.toBeNull();
    // as três ações têm exatamente a mesma classe (mesma facilidade e destaque)
    expect(new Set([...host.querySelectorAll('.cookie-actions button')].map((b) => b.className)).size).toBe(1);
  });

  it('rejeitar opcionais: grava a escolha e o banner some', async () => {
    await montar(<CookieConsent />);
    await clicar('Rejeitar opcionais');
    expect(host.querySelector('.cookie-banner')).toBeNull();
    expect(readConsent()).toMatchObject({ version: 3, necessary: true, google: false });
  });

  it('personalizar: modal lista as 5 categorias; necessários sempre ativos; sem integração = "Não utilizado" e sem controle', async () => {
    await montar(<CookieConsent />);
    await clicar('Personalizar preferências');
    const dlg = host.querySelector('[role="dialog"]')!;
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toContain('Necessários'); expect(dlg.textContent).toContain('Sempre ativos');
    for (const n of ['Preferências', 'Estatísticas', 'Marketing', 'Serviços externos']) expect(dlg.textContent).toContain(n);
    expect(dlg.querySelectorAll('.badge-neutro').length).toBe(4);
    expect(dlg.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    for (const t of ['Finalidade', 'Tecnologias', 'Prazo']) expect(dlg.textContent).toContain(t);
    expect(botoes()).toEqual(expect.arrayContaining(['Rejeitar opcionais', 'Aceitar todos', 'Salvar minhas escolhas']));
  });

  it('acesso permanente: o evento de "Preferências de cookies" abre o modal mesmo com escolha já feita, mostrando-a', async () => {
    await montar(<CookieConsent />);
    await clicar('Aceitar todos');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT)); });
    expect(host.querySelector('[role="dialog"]')!.textContent).toContain('Escolha registrada em');
    await clicar('Rejeitar opcionais');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Escape fecha o modal', async () => {
    await montar(<CookieConsent />);
    await clicar('Personalizar preferências');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('política atualizada na versão: escolha antiga (v2) faz o banner voltar', async () => {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify({ v: 2, google: false, updatedAt: 'x' }))}; Path=/`;
    await montar(<CookieConsent />);
    expect(host.querySelector('.cookie-banner')).not.toBeNull();
  });
});

describe('com o login Google reativado', () => {
  it('toggle começa desmarcado; permitir e revogar funcionam pelo modal', async () => {
    CATEGORIA_EM_USO.google = true;
    await montar(<CookieConsent />);
    await clicar('Personalizar preferências');
    const box = () => host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(1);
    expect(box().checked).toBe(false); // nada pré-selecionado
    await act(async () => { box().click(); });
    await clicar('Salvar minhas escolhas');
    expect(readConsent()).toMatchObject({ google: true, analytics: false, marketing: false });
    await act(async () => { window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT)); });
    expect(box().checked).toBe(true); // mostra a escolha atual
    await act(async () => { box().click(); });
    await clicar('Salvar minhas escolhas');
    expect(readConsent()!.google).toBe(false);
  });
  it('"Aceitar todos" liga só o Google, que é a única categoria real', async () => {
    CATEGORIA_EM_USO.google = true;
    await montar(<CookieConsent />);
    await clicar('Aceitar todos');
    expect(readConsent()).toMatchObject({ google: true, preferences: false, analytics: false, marketing: false });
  });
});

describe('página /privacidade', () => {
  it('só declara o que existe: cookies reais, nenhuma ferramenta de análise/publicidade, Google desativado', async () => {
    await montar(<PrivacyPage />);
    const t = host.textContent!;
    expect(t).toContain('__Host-crisoverde_session'); expect(t).toContain(CONSENT_COOKIE);
    expect(t).toContain('Versão 3.0');
    expect(t).toContain('Não usamos cookies de análise de uso, publicidade ou rastreamento');
    expect(t).toContain('Desativada no momento');
    expect(t).not.toMatch(/Google Analytics|Facebook Pixel|Meta Pixel|Hotjar|AdSense/i);
    expect(t).not.toContain('Cookies do Google'); // linha da tabela só aparece com o Google ativo
    expect(t).toContain('Como retirar o consentimento');
    expect(botoes()).toContain('Preferências de cookies');
  });
});
