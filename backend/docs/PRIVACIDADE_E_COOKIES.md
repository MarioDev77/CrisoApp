# Privacidade e cookies (política 3.0 — 10/11/2026)

## Onde está o código

- `frontend/src/consent.ts`: toda a lógica (cookie versionado, categorias, bloqueio, revogação). Sem React, testável.
- `frontend/src/App.tsx`: só a interface (`CookieConsent` = banner + modal; `PrivacyPage` = página `/privacidade`).
- `frontend/tests/`: 31 testes (`npm --prefix frontend test`).

## Cookies que o app realmente usa

| Cookie | Categoria | Duração | Observação |
|---|---|---|---|
| `__Host-crisoverde_session` (dev: `crisoverde_session`) | Necessário | 8 h | Criado pelo backend. HttpOnly, Secure, SameSite=Strict. Independente do consentimento. |
| `cv_cookie_consent` | Necessário | 180 dias | Guarda só a escolha. Path=/, SameSite=Lax, Secure em HTTPS, sem `Domain`. Não autentica ninguém e não contém dado pessoal. |
| `g_state` (do script do Google, no nosso domínio) | Serviços externos | definida pelo Google | **Só existe se o login com Google estiver ativo e permitido.** Hoje não existe. |

Não há `localStorage`/`sessionStorage`, analytics, pixels nem publicidade.

## Categorias

| Categoria | Situação hoje |
|---|---|
| Necessários | Em uso, sempre ativos. |
| Preferências | **Não utilizada** (o app não guarda personalização opcional). |
| Estatísticas | **Não utilizada** (nenhuma ferramenta instalada). |
| Marketing | **Não utilizada** (nenhuma publicidade/rastreador). |
| Serviços externos (login com Google) | **Desativada** (`GOOGLE_LOGIN_ATIVO = false`). |

Categorias sem integração real aparecem no modal como "Não utilizado", **sem controle ativo**, e não entram em "Aceitar todos". Isso é deliberado: gravar um "sim" para algo que não existe seria declarar uma coisa falsa. A tabela `CATEGORIA_EM_USO` em `consent.ts` é o único lugar que decide isso.

## Formato da escolha (`cv_cookie_consent`)

```json
{ "version": 3, "policyVersion": "3.0", "necessary": true,
  "preferences": false, "analytics": false, "marketing": false, "google": false,
  "offered": [], "updatedAt": "2026-11-10T00:00:00.000Z" }
```

`offered` lista as categorias opcionais que existiam (e foram mostradas) quando a pessoa decidiu.

A escolha é **ignorada** (o banner volta) quando: não há cookie; `version` ou `policyVersion` diferem; o cookie está corrompido/adulterado; ou passou a existir uma categoria em uso que não está em `offered`. Valores `true` para categoria sem integração são descartados na leitura.

## Bloqueio e revogação

- Todo recurso opcional passa por `carregarOpcional()`, que recusa se a categoria não está em uso ou não há permissão vigente. O `index.html` não tem nenhum host externo (as fontes agora são servidas pelo próprio site via `@fontsource/plus-jakarta-sans`; antes o Google Fonts era contatado a cada abertura, sem consentimento).
- Revogar: grava a nova escolha, apaga os cookies **próprios** da categoria (`g_state`), remove o `<script>` do Google e recarrega a página (um script já executado só se descarrega assim). Cookies gravados por um terceiro no domínio **dele** não podem ser apagados pelo site, e a interface não afirma o contrário.

## Como adicionar um analytics no futuro (checklist)

1. Marcar a categoria em `CATEGORIA_EM_USO` e listar os cookies próprios em `COOKIES_POR_CATEGORIA`.
2. Implementar o carregamento dentro de `carregarOpcional()` (nunca em `index.html`/`main.tsx`).
3. Ajustar a CSP em `frontend/vercel.json` e `backend/src/proxy.ts`.
4. Atualizar os textos em `CATEGORIAS` e subir `POLICY_VERSION`/`POLICY_DATE`.
5. Escrever o teste "nada carrega sem permissão" para a nova integração.

## Reativar o login com Google

Trocar `GOOGLE_LOGIN_ATIVO` para `true` em `frontend/src/consent.ts` **e** `GOOGLE_LOGIN_ATIVO=true` no backend. O toggle aparece no modal sozinho, a política passa a listar o Google, e quem já tinha escolhido antes vê o banner de novo (mudança de finalidade).

## Página /privacidade

Versão 3.0. Cobre controlador, dados, finalidades e bases legais (LGPD art. 7º, I, V e IX), tabela dos cookies reais, categorias e situação, compartilhamento, retenção, segurança, direitos (art. 18), menores e mudanças. O canal de privacidade vem de `VITE_CONTATO_PRIVACIDADE` (**defina antes de publicar**). O texto não substitui revisão jurídica.

## Acesso permanente

"Preferências de cookies" aparece no rodapé do app, na tela de login e no fim de `/privacidade`. O modal mostra a escolha atual e permite aceitar todos, rejeitar opcionais, alterar por categoria e revogar.
