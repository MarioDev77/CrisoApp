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
6. **IP do cliente / rate limit** — determine a cadeia de proxies observando a configuração real do serviço e logs controlados.
   Só habilite cabeçalhos de IP confiáveis depois de impedir que clientes contornem o proxy e falsifiquem esses cabeçalhos.
   Com `TRUSTED_PROXY=none`, limites por IP não atuam; limites por conta/e-mail continuam. Não escolha número de saltos nem
   provedor sem confirmar a topologia implantada.
7. Teste no ambiente de teste (login, QR crédito/débito, resgate, painel admin) antes de apontar o domínio de produção.
8. **Rollback:** Railway → Deployments → redeploy da versão anterior. Migrações são aditivas; para desfazer o schema restaure o backup.

## Proteção de borda / DDoS
Ainda precisa ser definida conforme o provedor e a topologia contratados. Configure WAF/rate limiting/restrição de origem no
painel real, valide que a origem não pode ser acessada contornando a borda e monitore tráfego e custo. A proteção no backend
é defesa complementar e não absorve DDoS volumétrico. Nenhum valor de regra ou ajuste de provedor foi aplicado nesta revisão.
