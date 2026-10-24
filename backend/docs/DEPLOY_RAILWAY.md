# Deploy no Railway (passo a passo — NADA disto foi executado ainda)

1. Crie um **projeto novo** com um serviço PostgreSQL e um serviço do repositório. Use primeiro um ambiente de **teste**.
2. Variáveis do serviço web (privadas; nenhuma `NEXT_PUBLIC_`): `DATABASE_URL` (referência ao Postgres), `JWT_SECRET`,
   `ADMIN_EMAIL`, `ADMIN_SENHA` (entre aspas se tiver `#`), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GOOGLE_CLIENT_ID`,
   `TRUSTED_PROXY`, `TRUSTED_PROXY_HOPS`, `APP_TIMEZONE`, `QR_MAX_UNIDADES_POR_MATERIAL`, `DB_POOL_MAX`, `LEGACY_BEARER=false`.
   **Gere todos os segredos novos** (os antigos devem ser considerados comprometidos).
3. `railway.json` já define build, `preDeployCommand` (`prisma migrate deploy`), start e health check em `/api/ready`.
4. Após o primeiro deploy, rode o seed uma vez: `railway run npm run db:seed`.
5. **Drift do Prisma:** a migração inicial foi escrita à mão (o ambiente de desenvolvimento não alcançava o download do engine do
   Prisma). Antes do primeiro deploy rode localmente:
   `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`
   (precisa de um banco "shadow"; veja a doc do Prisma). Se acusar diferença, gere uma nova migração com `prisma migrate dev`.
6. **IP do cliente / rate limit** — escolha com cuidado:
   - Direto no Railway (sem Cloudflare): `TRUSTED_PROXY=hops`, `TRUSTED_PROXY_HOPS=1` (confira nos logs que o IP real aparece como o
     último item de `X-Forwarded-For`).
   - Atrás da Cloudflare: `TRUSTED_PROXY=cloudflare` **somente** se a origem só aceitar tráfego da Cloudflare (ex.: Authenticated
     Origin Pulls ou mTLS); caso contrário qualquer um pode forjar `CF-Connecting-IP`.
   - Com `none`, os limites por IP são desligados (os limites por e-mail/usuário continuam).
7. Teste no ambiente de teste (login, QR crédito/débito, resgate, painel admin) antes de apontar o domínio de produção.
8. **Rollback:** Railway → Deployments → redeploy da versão anterior. Migrações são aditivas; para desfazer o schema restaure o backup.

## Cloudflare (recomendado, requer domínio próprio)
Proxy laranja ativo; SSL "Full (strict)"; WAF com regras gerenciadas; regra de rate limiting para `POST /api/auth/*`
(ex.: 20 req/min por IP); "Bot Fight Mode"; restringir a origem à Cloudflare. **Nenhuma proteção é absoluta contra DDoS**; a
Cloudflare absorve ataques volumétricos, mas ataques de aplicação (rotas caras, abuso autenticado) dependem dos limites e do
dimensionamento da origem.
