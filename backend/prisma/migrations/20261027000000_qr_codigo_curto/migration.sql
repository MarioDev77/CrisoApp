-- Código curto digitável do QR (alternativa à câmera). Aditiva e segura para rodar com o app no ar.
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS codigo_curto VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS qr_codes_codigo_curto_key ON qr_codes(codigo_curto);
