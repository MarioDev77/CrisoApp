-- Migração expansiva: somente adiciona estruturas NULL/defaultáveis. Não remove nem
-- altera dados legados. O preenchimento cifrado é feito separadamente pelo backfill.
ALTER TABLE usuarios
  ADD COLUMN email_enc TEXT,
  ADD COLUMN email_hash VARCHAR(64),
  ADD COLUMN telefone_enc TEXT,
  ADD COLUMN telefone_hash VARCHAR(64),
  ADD COLUMN google_id_hash VARCHAR(64);
CREATE UNIQUE INDEX usuarios_google_id_hash_key ON usuarios(google_id_hash);

ALTER TABLE lojas
  ADD COLUMN responsavel_enc TEXT,
  ADD COLUMN email_enc TEXT,
  ADD COLUMN email_hash VARCHAR(64),
  ADD COLUMN telefone_enc TEXT,
  ADD COLUMN telefone_hash VARCHAR(64),
  ADD COLUMN endereco_enc TEXT;

ALTER TABLE qr_codes
  ADD COLUMN token_hash VARCHAR(64),
  ADD COLUMN ip_enc TEXT,
  ADD COLUMN dados_enc TEXT;
CREATE UNIQUE INDEX qr_codes_token_hash_key ON qr_codes(token_hash);

ALTER TABLE logs_auditoria ADD COLUMN ip_enc TEXT;
ALTER TABLE transacoes ADD COLUMN nome_cliente_enc TEXT;

CREATE TABLE admin_mfa (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  segredo_enc TEXT NOT NULL,
  habilitado BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_hashes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE "ResgateStatus" AS ENUM ('pendente', 'aprovado', 'pago', 'cancelado');
CREATE TABLE resgates (
  id SERIAL PRIMARY KEY,
  id_cliente INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  id_transacao INTEGER UNIQUE REFERENCES transacoes(id) ON DELETE SET NULL,
  valor DECIMAL(10,2) NOT NULL CHECK (valor > 0),
  forma VARCHAR(20) NOT NULL,
  status "ResgateStatus" NOT NULL DEFAULT 'pendente',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX resgates_id_cliente_criado_em_idx ON resgates(id_cliente, criado_em);
CREATE INDEX resgates_status_criado_em_idx ON resgates(status, criado_em);

CREATE TABLE email_verification_codes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash VARCHAR(255) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TIMESTAMPTZ NOT NULL,
  tentativas INTEGER NOT NULL DEFAULT 0,
  utilizado BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX email_verification_codes_usuario_id_criado_em_idx ON email_verification_codes(usuario_id, criado_em);
