-- MFA para todas as contas (cliente, loja, admin). Executada sozinha no deploy (prisma migrate deploy).
-- Copia os dados de admin_mfa / admin_mfa_codigos (mesmo texto cifrado, mesmo contexto de criptografia)
-- e mantém as tabelas antigas intactas: pode apagá-las depois que o novo deploy estiver estável.
CREATE TABLE IF NOT EXISTS mfa_contas (
  id SERIAL PRIMARY KEY,
  conta_tipo VARCHAR(10) NOT NULL CHECK (conta_tipo IN ('usuario', 'loja')),
  conta_id INTEGER NOT NULL,
  segredo_enc TEXT NOT NULL,
  habilitado BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_hashes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mfa_contas_conta_tipo_conta_id_key UNIQUE (conta_tipo, conta_id)
);

CREATE TABLE IF NOT EXISTS mfa_codigos (
  id SERIAL PRIMARY KEY,
  mfa_id INTEGER NOT NULL REFERENCES mfa_contas(id) ON DELETE CASCADE,
  codigo_enc TEXT NOT NULL,
  codigo_hash VARCHAR(64) NOT NULL,
  usado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_codigos_mfa_id_codigo_hash_key ON mfa_codigos(mfa_id, codigo_hash);
CREATE INDEX IF NOT EXISTS mfa_codigos_mfa_id_usado_em_idx ON mfa_codigos(mfa_id, usado_em);

INSERT INTO mfa_contas (conta_tipo, conta_id, segredo_enc, habilitado, recovery_hashes, criado_em, atualizado_em)
SELECT 'usuario', usuario_id, segredo_enc, habilitado, recovery_hashes, criado_em, atualizado_em FROM admin_mfa
ON CONFLICT (conta_tipo, conta_id) DO NOTHING;

INSERT INTO mfa_codigos (mfa_id, codigo_enc, codigo_hash, usado_em, criado_em)
SELECT m.id, c.codigo_enc, c.codigo_hash, c.usado_em, c.criado_em
FROM admin_mfa_codigos c
JOIN mfa_contas m ON m.conta_tipo = 'usuario' AND m.conta_id = c.usuario_id
ON CONFLICT (mfa_id, codigo_hash) DO NOTHING;
