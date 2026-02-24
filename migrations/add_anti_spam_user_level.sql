-- =====================================================
-- Migration: Anti-Spam por usuário + blacklist global/usuário
-- Descrição: Permite qualquer cargo configurar anti-spam; blacklist do usuário vs global
-- Depende: create_anti_spam_tables.sql
-- =====================================================

-- 1) anti_spam_configs: suportar owner por usuário
ALTER TABLE anti_spam_configs
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'banca'
    CHECK (owner_type IN ('banca', 'user')),
  ADD COLUMN IF NOT EXISTS owner_id uuid NULL;

COMMENT ON COLUMN anti_spam_configs.owner_type IS 'banca = config admin (por banca); user = config do usuário';
COMMENT ON COLUMN anti_spam_configs.owner_id IS 'user_id quando owner_type=user';

-- Tornar banca_id opcional (config de usuário não tem banca)
ALTER TABLE anti_spam_configs ALTER COLUMN banca_id DROP NOT NULL;

-- Tornar denuncia_group_jid opcional
ALTER TABLE anti_spam_configs ALTER COLUMN denuncia_group_jid DROP NOT NULL;

-- Garantir configs existentes tenham owner_type correto
UPDATE anti_spam_configs SET owner_type = 'banca' WHERE owner_type IS NULL OR owner_type = '';

CREATE INDEX IF NOT EXISTS idx_anti_spam_configs_owner_user
  ON anti_spam_configs(owner_id) WHERE owner_type = 'user';

-- 2) anti_spam_blacklist: escopo global vs usuário
ALTER TABLE anti_spam_blacklist
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'user'));

COMMENT ON COLUMN anti_spam_blacklist.scope IS 'global = lista admin (só super_admin, admin, auditoria); user = lista do usuário';

-- Configs existentes (banca) = scope global; novas de usuário = scope user (definido na inserção)
UPDATE anti_spam_blacklist bl
SET scope = 'global'
WHERE scope IS NULL OR scope = ''
  AND EXISTS (SELECT 1 FROM anti_spam_configs c WHERE c.id = bl.config_id AND (c.owner_type = 'banca' OR c.owner_type IS NULL));

-- 3) anti_spam_event_cursor: suportar cursor por user_id
ALTER TABLE anti_spam_event_cursor
  ADD COLUMN IF NOT EXISTS user_id uuid NULL;

ALTER TABLE anti_spam_event_cursor ALTER COLUMN banca_id DROP NOT NULL;

-- Remover unique antigo em banca_id (para permitir null em banca_id quando user_id usado)
ALTER TABLE anti_spam_event_cursor DROP CONSTRAINT IF EXISTS anti_spam_event_cursor_banca_id_key;

-- Partial unique: um cursor por banca
CREATE UNIQUE INDEX IF NOT EXISTS idx_anti_spam_cursor_banca_unique
  ON anti_spam_event_cursor(banca_id) WHERE banca_id IS NOT NULL;

-- Partial unique: um cursor por user
CREATE UNIQUE INDEX IF NOT EXISTS idx_anti_spam_cursor_user_unique
  ON anti_spam_event_cursor(user_id) WHERE user_id IS NOT NULL;

-- Cursors existentes têm banca_id preenchido
COMMENT ON COLUMN anti_spam_event_cursor.user_id IS 'user_id quando cursor é de config de usuário';

-- 4) anti_spam_actions: adicionar user_id para rastrear ações de config usuário
ALTER TABLE anti_spam_actions
  ADD COLUMN IF NOT EXISTS user_id uuid NULL;

COMMENT ON COLUMN anti_spam_actions.user_id IS 'user_id quando ação é de config de usuário';
