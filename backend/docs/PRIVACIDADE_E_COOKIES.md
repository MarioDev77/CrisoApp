# Privacidade e cookies

## Como funciona (frontend/src/App.tsx)

- **Cookies necessários** (não dependem de consentimento):
  - `__Host-crisoverde_session` (em desenvolvimento: `crisoverde_session`): criado pelo backend, HttpOnly, Secure, SameSite=Strict, 8 horas.
  - `cv_cookie_consent`: guarda a escolha da pessoa, 180 dias, SameSite=Lax, Secure em HTTPS. Formato: `{ v: 2, google: boolean, updatedAt }`. Cookies de versões antigas (sem `v: 2`) são ignorados e o aviso volta a aparecer.
- **Única categoria opcional real: login com Google.** O script `accounts.google.com/gsi/client` só é carregado se `google: true`. Sem consentimento, a tela de login mostra o botão "Ativar login com Google". Ao retirar o consentimento o cookie `g_state` é apagado e a página recarrega para descarregar o script.
- `GOOGLE_LOGIN_ATIVO` (topo do `App.tsx`) está `false`. Enquanto estiver assim, o aviso é só informativo ("Entendi"), a política não lista cookies do Google e nenhum script de terceiros é carregado. Ao ligar a flag, banner, modal e política passam a mostrar a opção do Google sozinhos.
- Não há analytics, marketing nem armazenamento de sessão em localStorage/sessionStorage. Se algum dia for adicionado, criar uma nova categoria em `CookiePrefs`, subir a versão (`v`) e só carregar o script depois do consentimento.
- As preferências abrem pelo rodapé do app, pelo banner e pelo botão no fim da página `/privacidade`.

## Página /privacidade

Versão 2.0 (24/10/2026). Cobre: quem trata os dados, dados coletados, finalidades e bases legais (LGPD art. 7º), tabela de cookies, compartilhamento (Vercel, Railway, Resend, Google, lojas parceiras), retenção, segurança, direitos (art. 18), crianças e adolescentes e mudanças.

- O canal de privacidade vem da variável do frontend `VITE_CONTATO_PRIVACIDADE` (e-mail ou URL). Sem ela, a página manda falar com a equipe pelos canais da iniciativa. **Defina antes de publicar.**
- Prazos de retenção refletem o código: rate limit 1 h, QR usado/expirado 30 dias, auditoria 12 meses (`/api/cron/maintenance`), sessão 8 h. O cron precisa estar agendado com `CRON_SECRET`.
- Ao mudar o que o app coleta, usa ou compartilha, atualizar a página e `POLICY_VERSION`/`POLICY_DATE`.
- Texto não substitui revisão jurídica.
