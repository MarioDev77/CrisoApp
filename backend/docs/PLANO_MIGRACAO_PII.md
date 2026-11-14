# Plano de migração dos dados pessoais em texto claro

**Estado hoje (comprovado no código):** dupla escrita. Todo cadastro/alteração grava o valor em claro **e** `*_enc` (AES-256-GCM) + `*_hash` (HMAC) via `src/lib/pii.ts`. A leitura prefere o cifrado e cai no claro se faltar. Existe o backfill `npm run db:encrypt` (com `--dry-run` e a trava `--confirm-test-db`). **Nada em claro foi removido, de propósito.**

| Fase | O que faz | Risco | Status |
|---|---|---|---|
| 0 | Dupla escrita + índice cego para busca | nenhum | **feito** |
| 1 | Medir o que falta: `psql "$DATABASE_URL" -f docs/verificar_migracao_pii.sql` (somente leitura) | nenhum | **ferramenta pronta e testada** |
| 2 | Backup restaurável **validado**: restaurar numa cópia, rodar a verificação e abrir o app nela | perda de dados se pular | a fazer por você |
| 3 | Backfill: `npm run db:encrypt -- --dry-run`, depois `--confirm-test-db` **primeiro na cópia**, depois na produção. Rodar a verificação até tudo ficar 0 | baixo (idempotente, em lotes) | a fazer por você |
| 4 | Retirar o texto claro, em etapas **separadas**, cada uma depois de um período de observação: (a) `qr_codes.ip_gerado`, `logs_auditoria.ip`, `transacoes.nome_cliente` viram `NULL` por `UPDATE` em lote; (b) `usuarios.email`/`lojas.email` precisam virar nullable e perder o `UNIQUE` (o `email_hash` único assume), com o login passando a usar só o hash; (c) só então `DROP COLUMN` em migration própria | **alto**: (b) e (c) são mudança de schema | **não feito: precisa da sua aprovação** |

## Por que parei antes da fase 4

- `usuarios.email` e `lojas.email` são `NOT NULL UNIQUE` e o login ainda consulta `email_hash OR email`. Remover o claro exige mudar schema e o código de busca ao mesmo tempo.
- Nenhuma coluna antiga deve ser apagada antes de confirmar que **nenhuma** rota, relatório, script ou integração depende dela. Pontos conhecidos a conferir: exportações administrativas, `admin/qrcode/listar` (exibe IP) e o `seed`.
- Depois da fase 4(a) os valores em claro **não voltam**: por isso o backup validado (fase 2) vem antes.

## Chaves

`DATA_ENCRYPTION_KEYS` aceita várias chaves (`k1:...,k2:...`); a primeira cifra, todas decifram. Para rotacionar, adicione `k2` na frente e rode o backfill (ele re-cifra valores com chave antiga). Perder todas as chaves = perder os dados cifrados: guarde-as fora do banco.
