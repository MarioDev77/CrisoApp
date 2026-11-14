-- Verificação SOMENTE LEITURA da migração de dados pessoais (texto claro -> cifrado + índice cego).
-- Rode quantas vezes quiser; não altera nada. Resultado esperado depois do backfill: coluna "pendentes" = 0 em todas as linhas.
-- Uso: psql "$DATABASE_URL" -f docs/verificar_migracao_pii.sql
SELECT 'usuarios.email_enc' AS verificacao, count(*) AS pendentes FROM usuarios WHERE email_enc IS NULL
UNION ALL SELECT 'usuarios.email_hash',           count(*) FROM usuarios WHERE email_hash IS NULL
UNION ALL SELECT 'usuarios.telefone_enc',         count(*) FROM usuarios WHERE telefone <> '' AND telefone_enc IS NULL
UNION ALL SELECT 'usuarios.telefone_hash',        count(*) FROM usuarios WHERE telefone <> '' AND telefone_hash IS NULL
UNION ALL SELECT 'usuarios.google_id_hash',       count(*) FROM usuarios WHERE google_id IS NOT NULL AND google_id_hash IS NULL
UNION ALL SELECT 'lojas.email_enc',               count(*) FROM lojas WHERE email_enc IS NULL
UNION ALL SELECT 'lojas.email_hash',              count(*) FROM lojas WHERE email_hash IS NULL
UNION ALL SELECT 'lojas.responsavel_enc',         count(*) FROM lojas WHERE responsavel_enc IS NULL
UNION ALL SELECT 'lojas.telefone_enc',            count(*) FROM lojas WHERE telefone <> '' AND telefone_enc IS NULL
UNION ALL SELECT 'lojas.endereco_enc',            count(*) FROM lojas WHERE endereco IS NOT NULL AND endereco_enc IS NULL
UNION ALL SELECT 'qr_codes.dados_enc',            count(*) FROM qr_codes WHERE dados_enc IS NULL
UNION ALL SELECT 'qr_codes.token_hash',           count(*) FROM qr_codes WHERE token_hash IS NULL
UNION ALL SELECT 'qr_codes.ip_enc',               count(*) FROM qr_codes WHERE ip_gerado IS NOT NULL AND ip_enc IS NULL
UNION ALL SELECT 'transacoes.nome_cliente_enc',   count(*) FROM transacoes WHERE nome_cliente IS NOT NULL AND nome_cliente_enc IS NULL
UNION ALL SELECT 'logs_auditoria.ip_enc',         count(*) FROM logs_auditoria WHERE ip IS NOT NULL AND ip <> '' AND ip <> 'desconhecido' AND ip_enc IS NULL
ORDER BY 2 DESC, 1;

-- Informativo (não é pendência): colunas em claro que AINDA convivem com a versão cifrada (dupla escrita).
-- E-mail/telefone/endereço em claro não aparecem aqui de propósito: as colunas usuarios.email e lojas.email são
-- NOT NULL + UNIQUE e o login ainda consulta "email_hash OR email", então elas estão sempre preenchidas enquanto
-- a dupla escrita existir. Só podem ser retiradas na FASE 4 do plano (docs/PLANO_MIGRACAO_PII.md).
SELECT 'qr_codes com IP em claro' AS ainda_em_claro, count(*) FROM qr_codes WHERE ip_gerado IS NOT NULL
UNION ALL SELECT 'logs_auditoria com IP em claro', count(*) FROM logs_auditoria WHERE ip IS NOT NULL AND ip <> ''
UNION ALL SELECT 'transacoes com nome do cliente em claro', count(*) FROM transacoes WHERE nome_cliente IS NOT NULL;
