# Relatório de implementação — fases de segurança

## Escopo e limites

Esta revisão implementa controles no código. Não acessa nem altera Railway, Vercel, Cloudflare ou banco de produção. A migração `20261024000000_security_expand` é aditiva; ainda precisa ser aplicada primeiro em banco de teste, após backup restaurável. O script `db:encrypt` só grava se receber `--confirm-test-db` e não foi executado nesta revisão.

O `crypto.ts` recebido em `criptografia.zip` foi incorporado sem edição. A proteção implementada é criptografia de dados pessoais **em repouso no banco**, com AES-GCM, índice cego para buscas e rotação de chaves. Isto não é criptografia ponta a ponta: o backend precisa descriptografar os dados para autenticar usuários, processar QR e operar resgates. E2E real exige decidir quais dados o servidor pode deixar de ler e redesenhar essas jornadas.

## Resultado por grupo do relatório de vulnerabilidades

| Grupo | Implementação local | Situação / risco residual |
|---|---|---|
| V1 — confirmação de e-mail | OTP de seis dígitos, expiração, tentativas limitadas, hash com namespace próprio e bloqueio de QR/resgate até confirmação | Depende de Resend configurado e teste de entrega no ambiente de homologação. |
| V2/V5 — dados pessoais | Dual-write cifrado, índices cegos, leituras compatíveis com registros antigos e script de backfill em lotes | **Migração e backfill pendentes.** Não remover campos legados até validar contagens e amostras em cópia restaurada. |
| V3 — fraude/créditos/resgates | Limites diários: R$ 300 por loja, R$ 150 por cliente, R$ 100 por resgates; carência de 24h; bloqueio transacional e trilha de auditoria | Homologar concorrência e regras de cancelamento com o negócio. |
| V4 — busca com dados protegidos | Consultas de e-mail/Google usam índices cegos com fallback de legado | Validar duplicidade/normalização em banco restaurado antes do backfill. |
| V6 — MFA administrativo | TOTP, códigos de recuperação de uso único, segredo cifrado e bloqueio das rotas admin sem MFA | Primeiro login exige provisionamento e guardar os códigos de recuperação. Requer chaves de criptografia. |
| V7 — resgate | Sessão recente, e-mail confirmado, saldo/carência, teto diário e ciclo pendente/aprovado/pago/cancelado com estorno | Resposta passa a incluir `status` e `id_resgate`; clientes que dependam do JSON antigo precisam ser atualizados. |
| V8 — origem privada | `proxy.ts` compara o header secreto quando `ORIGIN_SECRET` está configurado | **Proteção ainda não ativada.** A variável é opcional e a configuração atual de rewrite da Vercel não injeta esse header. Acesso direto à origem não fica bloqueado por esta mudança. Defina uma arquitetura de proxy/header no provedor e valide antes de habilitar o segredo; nunca o inclua no bundle ou em `vercel.json`. |
| V9 — cabeçalhos/CSP | CSP e cabeçalhos de segurança no `frontend/vercel.json`; estilos inline do React removidos | Validar login, câmera/QR e deploy real sob CSP. |
| V10 — segredos | Separação de sessão, OTP, QR, criptografia e blind index; suporte a rotação de sessão | Criar e guardar os valores fora do repositório; mudanças de segredo podem invalidar tokens antigos. |
| V11 — DoS/rate limit | Limites em memória antes de DB, contadores PostgreSQL com chaves derivadas, tamanho máximo do body (10 KB) e limpeza protegida por `CRON_SECRET` | **Não mitiga DDoS volumétrico.** Limite de borda/WAF, restrição da origem e ajuste de capacidade devem ser feitos e medidos no provedor real. Com IP desconhecido, limite por IP é deliberadamente ignorado. |
| V12 — recuperação | Respostas genéricas, limites, OTP com tentativas/expiração e token de reset separado | Envio ainda é síncrono; não há fila. Comparação temporal completa de existência de conta não foi demonstrada como equivalente. |
| V13/V14 — login/senhas | Mensagem genérica, hash falso para conta inexistente, limite de bytes e bcrypt | Homologar compatibilidade com senhas antigas e novas regras. |
| V15/V16 — payload e sessão | Leitura limitada do stream, cookie HttpOnly/SameSite; prefixo `__Host-` em produção e nome compatível com localhost em desenvolvimento | Requer HTTPS em produção e validar callback/proxy. |
| V17 — QR | Tokens não retornados em listagem administrativa; dados/IP cifrados e detecção de volume suspeito | Backfill dos QR existentes pendente; proteger origem e validar alertas reais. |
| V18 — exclusão/retensão | Exclusão lógica/anônima e endpoint autenticado por segredo para retenção | Política jurídica de retenção e agenda do endpoint precisam ser confirmadas pelo operador. |
| V19 — banco/dependências | Documentada necessidade de SSL para URL pública; pacote `uuid` removido | SSL e auditoria atual de dependências precisam ser confirmados no ambiente de deploy. |

## Respostas da API

O endpoint de resgate mudou intencionalmente para incluir `status` e `id_resgate`. A confirmação do e-mail e o MFA também adicionam rotas e campos de fluxo. Os demais contratos existentes foram mantidos na implementação, mas a homologação é necessária para detectar consumidores externos não presentes no repositório.

## Verificações executadas

- Backend: `prisma generate`, TypeScript, ESLint e Vitest passaram — 33 testes.
- Frontend: TypeScript e `vite build` passaram antes da última tentativa de instalação limpa.
- `next build --webpack` não concluiu: o Windows/sandbox retornou `EPERM` ao criar `.next/types/app/api/loja/historico`. O script integrado foi corrigido para usar `cwd`; na nova tentativa, `npm ci` ficou sem saída e foi interrompido. A compilação Next completa continua pendente.
- Não foram executados testes funcionais com PostgreSQL, migração, backfill, `npm audit` ou validação em provedor.

## Ordem segura de ativação

1. Fazer backup e restaurá-lo em banco isolado de homologação; verificar o schema original.
2. Configurar segredos novos em ambiente privado e testar e-mail, IP confiável e o segredo entre proxy e API.
3. Aplicar a migration expansiva no banco de homologação.
4. Rodar `npm run db:encrypt -- --dry-run`; revisar somente contagens. Depois, em banco restaurado de teste, usar `--confirm-test-db` e validar amostras/índices.
5. Rodar a suíte funcional, testar primeiro login/MFA, confirmação de e-mail, crédito, carência, resgate, estorno, logout e recuperação.
6. Só então repetir backup, janela de mudança e sequência aprovada em produção. A limpeza de campos antigos requer etapa futura separada.

Não rode o backfill contra produção até que o destino da conexão esteja identificado sem ambiguidade e o backup tenha restauração comprovada.
