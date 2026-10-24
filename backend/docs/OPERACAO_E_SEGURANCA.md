# Operação, backup e resposta a incidentes (plano — a executar no ambiente real)

## Monitoramento (a configurar)
- Health: `/api/health` (processo) e `/api/ready` (banco). Alertas se `/api/ready` falhar > 2 min.
- Logs JSON em stdout (`req` com método, rota, status, ms; `erro_interno` com `ref` para correlacionar). Sem senhas/tokens.
- Acompanhar: taxa de 429 e 5xx, latência p95, CPU/memória, conexões do Postgres (`DB_POOL_MAX` por instância), custo no Railway
  (defina limite de uso/alertas de gasto no painel).

## Backup e restauração
- Ativar backups do Postgres no Railway e, adicionalmente, `pg_dump` agendado para armazenamento externo.
- **Testar a restauração** em um banco de teste a cada trimestre: `pg_restore --clean --if-exists -d "$DB_TESTE" dump.dump`
  e conferir contagens (`usuarios`, `lojas`, `transacoes`) e a regra `saldo = créditos − débitos` por cliente.

## Resposta a incidentes
1. Detectar (alerta) → confirmar no painel de métricas/logs se é tráfego (429/5xx, IPs, rotas) ou falha interna.
2. Conter: ativar "Under Attack"/regra de rate limit na Cloudflare; reduzir limites; se necessário, pôr o app em manutenção.
3. Credenciais suspeitas: rotacionar `JWT_SECRET` (encerra todas as sessões), senha do banco e chaves de API.
4. Fraude de crédito: consultar `logs_auditoria` (`valor_adulterado`, `volume_suspeito`, `ip_divergente`, `limite_diario*`) e
   `qr_codes`; invalidar QR pelo painel; bloquear a loja (exclusão lógica encerra sessões).
5. Recuperar → registrar a linha do tempo → corrigir a causa → atualizar este plano.

## Limitações conhecidas
- Rate limit da aplicação usa o PostgreSQL (uma gravação por verificação): suporta o volume esperado, mas não substitui o limite de borda.
- Sem Redis: se o tráfego legítimo crescer muito, migrar o contador para Redis.
