-- CrisoVerde 2.0 — migração inicial (PostgreSQL). Escrita à mão a partir do schema.prisma.
-- Confirme ausência de drift com:  npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code

CREATE TYPE "UsuarioTipo"     AS ENUM ('cliente', 'admin');
CREATE TYPE "UsuarioStatus"   AS ENUM ('ativo', 'bloqueado', 'inativo');
CREATE TYPE "UsuarioProvider" AS ENUM ('local', 'google');
CREATE TYPE "LojaStatus"      AS ENUM ('ativo', 'pendente', 'inativo');
CREATE TYPE "TransacaoTipo"   AS ENUM ('credito', 'debito');
CREATE TYPE "TransacaoCat"    AS ENUM ('reciclagem', 'resgate');
CREATE TYPE "QrStatus"        AS ENUM ('ativo', 'usado', 'expirado', 'invalido');

CREATE TABLE "usuarios" (
  "id" SERIAL NOT NULL,
  "nome" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "senha" VARCHAR(255),
  "tipo" "UsuarioTipo" NOT NULL DEFAULT 'cliente',
  "status" "UsuarioStatus" NOT NULL DEFAULT 'ativo',
  "telefone" VARCHAR(50) NOT NULL DEFAULT '',
  "saldo" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_ganho" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_utilizado" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_reciclado_kg" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total_trocas" INTEGER NOT NULL DEFAULT 0,
  "provider" "UsuarioProvider" NOT NULL DEFAULT 'local',
  "google_id" VARCHAR(255),
  "foto" VARCHAR(500),
  "email_verificado" BOOLEAN NOT NULL DEFAULT false,
  "ultimo_login" TIMESTAMPTZ,
  "versao_sessao" INTEGER NOT NULL DEFAULT 0,
  "deletado_em" TIMESTAMPTZ,
  "deletado_por" INTEGER,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usuarios_saldo_nao_negativo" CHECK ("saldo" >= 0),
  CONSTRAINT "usuarios_email_minusculo" CHECK ("email" = lower("email"))
);

CREATE TABLE "lojas" (
  "id" SERIAL NOT NULL,
  "nome" VARCHAR(255) NOT NULL,
  "responsavel" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "telefone" VARCHAR(50) NOT NULL DEFAULT '',
  "endereco" TEXT,
  "senha" VARCHAR(255) NOT NULL,
  "status" "LojaStatus" NOT NULL DEFAULT 'pendente',
  "versao_sessao" INTEGER NOT NULL DEFAULT 0,
  "deletado_em" TIMESTAMPTZ,
  "deletado_por" INTEGER,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lojas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lojas_email_minusculo" CHECK ("email" = lower("email"))
);

CREATE TABLE "transacoes" (
  "id" SERIAL NOT NULL,
  "id_cliente" INTEGER,
  "nome_cliente" VARCHAR(255),
  "id_loja" INTEGER,
  "nome_loja" VARCHAR(255),
  "tipo" "TransacaoTipo" NOT NULL,
  "categoria" "TransacaoCat" NOT NULL DEFAULT 'reciclagem',
  "valor" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "kg" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "materiais" JSONB,
  "materiais_desc" VARCHAR(500) NOT NULL DEFAULT '-',
  "forma" VARCHAR(50) NOT NULL DEFAULT 'pix',
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transacoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transacoes_valor_nao_negativo" CHECK ("valor" >= 0),
  CONSTRAINT "transacoes_kg_nao_negativo" CHECK ("kg" >= 0)
);

CREATE TABLE "qr_codes" (
  "token" VARCHAR(255) NOT NULL,
  "id_transacao" SERIAL NOT NULL,
  "id_loja" INTEGER NOT NULL,
  "nome_loja" VARCHAR(255),
  "tipo" "TransacaoTipo" NOT NULL DEFAULT 'credito',
  "valor" DECIMAL(10,2) NOT NULL,
  "materiais" JSONB,
  "materiais_desc" VARCHAR(500) NOT NULL DEFAULT '-',
  "produto" VARCHAR(255),
  "status" "QrStatus" NOT NULL DEFAULT 'ativo',
  "ip_gerado" VARCHAR(64),
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expira_em" TIMESTAMPTZ NOT NULL,
  "usado_em" TIMESTAMPTZ,
  "id_cliente" INTEGER,
  CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("token"),
  CONSTRAINT "qr_codes_valor_nao_negativo" CHECK ("valor" >= 0)
);

CREATE TABLE "configuracoes" (
  "chave" VARCHAR(100) NOT NULL,
  "valor" JSONB NOT NULL,
  CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("chave")
);

CREATE TABLE "logs_auditoria" (
  "id" SERIAL NOT NULL,
  "id_cliente" INTEGER,
  "acao" VARCHAR(100),
  "detalhe" TEXT,
  "ip" VARCHAR(64),
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logs_auditoria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "password_reset_codes" (
  "id" SERIAL NOT NULL,
  "usuario_id" INTEGER NOT NULL,
  "codigo_hash" VARCHAR(255) NOT NULL,
  "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expira_em" TIMESTAMPTZ NOT NULL,
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "utilizado" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_limits" (
  "chave" VARCHAR(255) NOT NULL,
  "contagem" INTEGER NOT NULL DEFAULT 0,
  "expira_em" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("chave")
);

CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");
CREATE UNIQUE INDEX "usuarios_google_id_key" ON "usuarios"("google_id");
CREATE INDEX "usuarios_status_idx" ON "usuarios"("status");
CREATE INDEX "usuarios_tipo_criado_em_idx" ON "usuarios"("tipo", "criado_em");
CREATE UNIQUE INDEX "lojas_email_key" ON "lojas"("email");
CREATE INDEX "transacoes_criado_em_idx" ON "transacoes"("criado_em");
CREATE INDEX "transacoes_tipo_criado_em_idx" ON "transacoes"("tipo", "criado_em");
CREATE INDEX "transacoes_id_cliente_tipo_criado_em_idx" ON "transacoes"("id_cliente", "tipo", "criado_em");
CREATE INDEX "transacoes_id_loja_tipo_criado_em_idx" ON "transacoes"("id_loja", "tipo", "criado_em");
CREATE UNIQUE INDEX "qr_codes_id_transacao_key" ON "qr_codes"("id_transacao");
CREATE INDEX "qr_codes_status_idx" ON "qr_codes"("status");
CREATE INDEX "qr_codes_criado_em_idx" ON "qr_codes"("criado_em");
CREATE INDEX "qr_codes_id_loja_status_idx" ON "qr_codes"("id_loja", "status");
CREATE INDEX "logs_auditoria_acao_idx" ON "logs_auditoria"("acao");
CREATE INDEX "logs_auditoria_criado_em_idx" ON "logs_auditoria"("criado_em");
CREATE INDEX "password_reset_codes_usuario_id_idx" ON "password_reset_codes"("usuario_id");
CREATE INDEX "rate_limits_expira_em_idx" ON "rate_limits"("expira_em");

ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_deletado_por_fkey" FOREIGN KEY ("deletado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lojas" ADD CONSTRAINT "lojas_deletado_por_fkey" FOREIGN KEY ("deletado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transacoes" ADD CONSTRAINT "transacoes_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transacoes" ADD CONSTRAINT "transacoes_id_loja_fkey" FOREIGN KEY ("id_loja") REFERENCES "lojas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_id_loja_fkey" FOREIGN KEY ("id_loja") REFERENCES "lojas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "logs_auditoria" ADD CONSTRAINT "logs_auditoria_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Configuração padrão
INSERT INTO "configuracoes" ("chave", "valor") VALUES
  ('taxas', '{"papelao":7,"plastico":10,"aluminio":6,"vidro":4}'),
  ('qr',    '{"expiracao_segundos":60,"max_tentativas":5}')
ON CONFLICT ("chave") DO NOTHING;
