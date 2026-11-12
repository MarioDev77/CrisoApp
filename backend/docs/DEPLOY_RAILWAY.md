# Deploy no Railway (passo a passo — NADA disto foi executado ainda)

1. Crie um **projeto novo** com um serviço PostgreSQL e um serviço do repositório. Use primeiro um ambiente de **teste**.
2. Configure no painel apenas valores confirmados para este ambiente. A aplicação agora requer em produção `SESSION_SECRET`,
   `OTP_PEPPER`, `QR_SIGNING_SECRET`, `DATA_ENCRYPTION_KEYS` e `BLIND_INDEX_KEY`; também usa `ORIGIN_SECRET` entre o proxy
   que publica a API e o serviço backend, e `CRON_SECRET` no agendamento de manutenção. Não copie valores deste documento,
   não coloque segredos em variáveis públicas ou no bundle do frontend e não assuma qual cabeçalho/proxy está ativo. Gere os
   segredos fora deste repositório e valide o fluxo da Vercel/Railway real. `DATABASE_URL`, e-mail, Google, pool, fuso e
   demais valores dependem da configuração existente do projeto.
3. `railway.json` já define build, `preDeployCommand` (`prisma migrate deploy`), start e health check em `/api/ready`.
4. Após o primeiro deploy, rode o seed uma vez: `railway run npm run db:seed`.
5. **Drift do Prisma:** a migração inicial foi escrita à mão (o ambiente de desenvolvimento não alcançava o download do engine do
   Prisma). Antes do primeiro deploy rode localmente:
   `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`
   (precisa de um banco "shadow"; veja a doc do Prisma). Se acusar diferença, gere uma nova migração com `prisma migrate dev`.
6. **IP do cliente / rate limit** — leia `docs/RATE_LIMIT_E_IP.md` e rode `GET /api/diagnostico/ip` (Bearer `CRON_SECRET`) pelo
   domínio da Vercel **e** direto no Railway antes de mudar `TRUSTED_PROXY`. O padrão `none` é seguro: não há limite por IP
   enganado, a conta é protegida por contenção progressiva (com cookie de dispositivo) e a rota emite o alerta `ip_nao_identificado`.
7. Teste no ambiente de teste (login, QR crédito/débito, resgate, painel admin) antes de apontar o domínio de produção.
8. **Rollback:** Railway → Deployments → redeploy da versão anterior. Migrações são aditivas; para desfazer o schema restaure o backup.

## Proteção de borda / DDoS
Ainda precisa ser definida conforme o provedor e a topologia contratados. Configure WAF/rate limiting/restrição de origem no
painel real, valide que a origem não pode ser acessada contornando a borda e monitore tráfego e custo. A proteção no backend
é defesa complementar e não absorve DDoS volumétrico. Nenhum valor de regra ou ajuste de provedor foi aplicado nesta revisão.
