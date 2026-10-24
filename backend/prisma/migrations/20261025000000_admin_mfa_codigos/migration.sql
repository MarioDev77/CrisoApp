-- Códigos de recuperação do MFA administrativo, um por linha, com o texto cifrado.
-- Executada automaticamente no deploy (preDeployCommand = prisma migrate deploy).
-- IF NOT EXISTS deixa a migração segura caso a tabela já exista em algum ambiente.
CREATE TABLE IF NOT EXISTS admin_mfa_codigos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES admin_mfa(usuario_id) ON DELETE CASCADE,
  codigo_enc TEXT NOT NULL,
  codigo_hash VARCHAR(64) NOT NULL,
  usado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_mfa_codigos_usuario_id_codigo_hash_key ON admin_mfa_codigos(usuario_id, codigo_hash);
CREATE INDEX IF NOT EXISTS admin_mfa_codigos_usuario_id_usado_em_idx ON admin_mfa_codigos(usuario_id, usado_em);
