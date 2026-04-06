-- Palavras-chave para apagar mensagens automaticamente (anti-spam)
-- + flag na config

ALTER TABLE anti_spam_configs
  ADD COLUMN IF NOT EXISTS suspicious_messages_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN anti_spam_configs.suspicious_messages_enabled IS 'Se true, apaga mensagens que contiverem palavras da lista (grupos, via Evolution deleteMessageForEveryone)';

CREATE TABLE IF NOT EXISTS anti_spam_suspicious_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES anti_spam_configs(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anti_spam_suspicious_keywords IS 'Palavras que disparam exclusão da mensagem para todos (anti-spam)';
CREATE INDEX IF NOT EXISTS idx_anti_spam_suspicious_kw_config ON anti_spam_suspicious_keywords(config_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_suspicious_kw_enabled ON anti_spam_suspicious_keywords(config_id) WHERE is_enabled = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_anti_spam_suspicious_kw_unique
  ON anti_spam_suspicious_keywords (config_id, lower(btrim(keyword)));
