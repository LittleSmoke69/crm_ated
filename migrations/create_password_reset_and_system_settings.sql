-- =====================================================
-- Migration: Tabelas para Esqueci a senha e Loto Assistência
-- Descrição: password_reset_codes (código de recuperação) e system_settings (config admin)
-- =====================================================

-- Tabela de códigos de recuperação de senha (expira em 15 min, código 6 dígitos)
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  phone_sent_to TEXT NOT NULL,
  reset_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_profile_id ON password_reset_codes(profile_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_reset_token ON password_reset_codes(reset_token) WHERE reset_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_password_reset_codes_expires_at ON password_reset_codes(expires_at);

COMMENT ON TABLE password_reset_codes IS 'Códigos de 6 dígitos para fluxo esqueci a senha; reset_token preenchido após verificação do código.';

-- Tabela de configurações do sistema (chave/valor)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE system_settings IS 'Configurações globais (ex: loto_assistencia_instance_id para instância Evolution que envia SMS de recuperação de senha).';

-- Valor inicial opcional (pode ser definido pelo admin)
-- INSERT INTO system_settings (key, value) VALUES ('loto_assistencia_instance_id', NULL) ON CONFLICT (key) DO NOTHING;
