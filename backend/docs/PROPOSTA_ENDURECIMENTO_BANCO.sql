-- =====================================================================================
-- PROPOSTA (NÃO aplicada) — endurecimento do banco do CrisoApp
-- =====================================================================================
-- Este arquivo fica em docs/ de propósito: o Railway roda `prisma migrate deploy` a cada deploy,
-- então NADA que estiver em prisma/migrations sobe sem você ver. Só mova para lá depois de aprovar.
--
-- Como aplicar com segurança:
--   1. Faça backup restaurável (Railway > Postgres > Backups) e teste primeiro numa cópia.
--   2. Rode UMA seção por vez (A, B, C, D). Cada seção tem o seu "DESFAZER" no final.
--   3. Nenhuma seção apaga dado. B usa NOT VALID (não reprova linhas antigas); C só cria índice; D só impede
--      alterar/apagar log recente; A só cria um papel novo (o app continua funcionando com o papel atual
--      até você trocar a DATABASE_URL).
-- =====================================================================================


-- =====================================================================================
-- A) MENOR PRIVILÉGIO — o app não deve conectar como dono/superusuário do banco
-- =====================================================================================
-- O QUE MUDA : cria o papel criso_app, que só lê/grava dados (SELECT/INSERT/UPDATE/DELETE) e NÃO pode
--              CREATE/ALTER/DROP/TRUNCATE nem tocar na tabela _prisma_migrations.
-- POR QUÊ    : hoje a DATABASE_URL do Railway é o usuário "postgres" (dono). Uma falha de SQL injection
--              ou vazamento da URL deixaria o atacante apagar o banco inteiro (DROP TABLE).
-- IMPACTO    : nenhum até você trocar a variável. Depois, o serviço usa criso_app em DATABASE_URL e o
--              preDeploy (migrate deploy) usa a URL do dono em MIGRATE_DATABASE_URL (ver prisma.config.ts).
-- COMO USAR  : psql "<url do dono>" -v senha_app="'TROQUE_POR_UMA_SENHA_FORTE'" -f este_arquivo (seção A)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'criso_app') THEN
    CREATE ROLE criso_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
-- (defina a senha à parte:  ALTER ROLE criso_app PASSWORD '...';  — nunca commite a senha)

GRANT USAGE ON SCHEMA public TO criso_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO criso_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO criso_app;
-- tabelas/sequências criadas por migrations futuras (rodadas pelo dono) já nascem com esse acesso:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO criso_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO criso_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public._prisma_migrations FROM criso_app';
  END IF;
END $$;
-- tabelas antigas que o código não usa mais (admin_mfa, admin_mfa_codigos) continuam acessíveis só se você quiser;
-- depois de estável, o ideal é apagá-las numa migration própria (cópia já feita pela migration 20261026000000).

-- DESFAZER A:
--   REASSIGN OWNED BY criso_app TO postgres; DROP OWNED BY criso_app; DROP ROLE criso_app;
--   (e volte DATABASE_URL para a URL anterior)


-- =====================================================================================
-- B) CONSTRAINTS — valores inválidos não entram mais no banco (defesa além do Zod)
-- =====================================================================================
-- O QUE MUDA : CHECKs nas tabelas usuarios, qr_codes, resgates, rate_limits.
-- POR QUÊ    : hoje só saldo/valor têm CHECK; contadores negativos, e-mail/telefone malformado e QR que
--              "expira antes de nascer" só são barrados pelo código da aplicação.
-- IMPACTO    : NOT VALID = vale só para linhas novas/alteradas; as antigas não são reprovadas. Depois de
--              conferir (consultas "SELECT ... WHERE NOT (...)" abaixo) rode VALIDATE CONSTRAINT.
-- Telefone: o app grava só dígitos (10–13) ou vazio (normalizarTelefone). Não cria regra frágil de DDD.
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_totais_nao_negativos CHECK (total_ganho >= 0 AND total_utilizado >= 0 AND total_reciclado_kg >= 0 AND total_trocas >= 0) NOT VALID,
  ADD CONSTRAINT usuarios_email_formato CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') NOT VALID,
  ADD CONSTRAINT usuarios_telefone_formato CHECK (telefone ~ '^[0-9]{0,13}$') NOT VALID;
ALTER TABLE lojas
  ADD CONSTRAINT lojas_email_formato CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') NOT VALID;
ALTER TABLE qr_codes
  ADD CONSTRAINT qr_codes_expira_depois_de_criar CHECK (expira_em > criado_em) NOT VALID;
ALTER TABLE resgates
  ADD CONSTRAINT resgates_forma_valida CHECK (forma IN ('pix')) NOT VALID;
ALTER TABLE rate_limits
  ADD CONSTRAINT rate_limits_contagem_nao_negativa CHECK (contagem >= 0) NOT VALID;

-- Conferência antes de validar (todas devem devolver 0 linhas):
--   SELECT id FROM usuarios WHERE NOT (total_ganho >= 0 AND total_utilizado >= 0 AND total_reciclado_kg >= 0 AND total_trocas >= 0);
--   SELECT id, telefone FROM usuarios WHERE telefone !~ '^[0-9]{0,13}$';
--   SELECT id FROM usuarios WHERE email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
--   SELECT id FROM lojas    WHERE email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
-- Depois: ALTER TABLE usuarios VALIDATE CONSTRAINT usuarios_telefone_formato;  (e as demais)

-- DESFAZER B:
--   ALTER TABLE usuarios DROP CONSTRAINT usuarios_totais_nao_negativos, DROP CONSTRAINT usuarios_email_formato, DROP CONSTRAINT usuarios_telefone_formato;
--   ALTER TABLE lojas DROP CONSTRAINT lojas_email_formato;
--   ALTER TABLE qr_codes DROP CONSTRAINT qr_codes_expira_depois_de_criar;
--   ALTER TABLE resgates DROP CONSTRAINT resgates_forma_valida;
--   ALTER TABLE rate_limits DROP CONSTRAINT rate_limits_contagem_nao_negativa;


-- =====================================================================================
-- C) ÍNDICES — só os que o código realmente usa e ainda não têm
-- =====================================================================================
-- O QUE MUDA : índice em usuarios.email_hash e lojas.email_hash.
-- POR QUÊ    : TODO login/cadastro/recuperação faz  WHERE email_hash = ? OR email = ?  (pii.ts). O OR faz o
--              Postgres varrer a tabela inteira porque email_hash não tem índice; piora conforme cresce.
-- CUSTO      : 1 índice pequeno por tabela; a escrita em usuarios/lojas é rara. Não criei índice em
--              logs_auditoria(id_cliente) nem qr_codes(id_cliente): são FKs que nunca sofrem DELETE
--              (exclusão é lógica), então o índice só custaria escrita sem ganho.
-- AO APLICAR : acrescente  @@index([emailHash])  nos models Usuario e Loja do schema.prisma para não
--              gerar "drift" (o nome padrão do Prisma é usuarios_email_hash_idx / lojas_email_hash_idx).
-- Em produção com tabela grande use CREATE INDEX CONCURRENTLY (fora de transação).
CREATE INDEX IF NOT EXISTS usuarios_email_hash_idx ON usuarios (email_hash);
CREATE INDEX IF NOT EXISTS lojas_email_hash_idx    ON lojas (email_hash);

-- DESFAZER C:
--   DROP INDEX IF EXISTS usuarios_email_hash_idx; DROP INDEX IF EXISTS lojas_email_hash_idx;


-- =====================================================================================
-- D) LOG DE AUDITORIA IMUTÁVEL — nem o próprio app consegue reescrever a história recente
-- =====================================================================================
-- O QUE MUDA : trigger em logs_auditoria. UPDATE é proibido; DELETE só vale para linhas com mais de 12 meses
--              (exatamente o que o /api/cron/maintenance já faz). Única exceção de UPDATE: a FK id_cliente
--              virar NULL (ON DELETE SET NULL), para não travar uma eventual exclusão física de usuário.
-- POR QUÊ    : hoje qualquer código com acesso ao banco (inclusive um atacante com SQL injection) pode
--              apagar ou editar o rastro das próprias ações.
-- IMPACTO    : o script `npm run db:encrypt` faz UPDATE em logs_auditoria: rode-o ANTES de ativar esta seção
--              (ou desative o trigger durante o backfill). Não afeta nenhuma rota.
CREATE OR REPLACE FUNCTION logs_auditoria_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.criado_em < now() - interval '12 months' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'logs_auditoria: só é permitido apagar registros com mais de 12 meses (retenção)';
  END IF;
  -- UPDATE: somente id_cliente -> NULL, mantendo todo o resto idêntico
  IF NEW.id_cliente IS NULL AND (to_jsonb(NEW) - 'id_cliente') = (to_jsonb(OLD) - 'id_cliente') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'logs_auditoria é append-only: UPDATE não permitido';
END $$;

DROP TRIGGER IF EXISTS logs_auditoria_imutavel_trg ON logs_auditoria;
CREATE TRIGGER logs_auditoria_imutavel_trg
  BEFORE UPDATE OR DELETE ON logs_auditoria
  FOR EACH ROW EXECUTE FUNCTION logs_auditoria_imutavel();

-- LIMITE HONESTO: o dono do banco (ou quem for superusuário) pode desligar o trigger. A imutabilidade real contra
-- o app vem de A + D juntos: o app roda como criso_app, que não é dono da tabela e não pode DROP/ALTER TRIGGER.

-- DESFAZER D:
--   DROP TRIGGER IF EXISTS logs_auditoria_imutavel_trg ON logs_auditoria; DROP FUNCTION IF EXISTS logs_auditoria_imutavel();
