-- =====================================================
-- Migration: Módulo Anti-Spam Real Time (Zaploto + Evolution API)
-- Descrição: Tabelas para config, grupos monitorados, blacklist, cursor de eventos e logs de ação
-- =====================================================

-- 1) Config do Anti-Spam (uma por banca)
CREATE TABLE IF NOT EXISTS anti_spam_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  master_instance_id uuid NOT NULL REFERENCES evolution_instances(id) ON DELETE RESTRICT,
  watcher_instance_id uuid NULL REFERENCES evolution_instances(id) ON DELETE SET NULL,
  denuncia_group_jid text NOT NULL,
  scan_mode text NOT NULL DEFAULT 'all_groups' CHECK (scan_mode IN ('all_groups', 'selected_groups')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anti_spam_configs IS 'Configuração do Anti-Spam por banca: instâncias, grupo de denúncia e modo de varredura';
CREATE INDEX IF NOT EXISTS idx_anti_spam_configs_banca_id ON anti_spam_configs(banca_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_configs_is_enabled ON anti_spam_configs(is_enabled) WHERE is_enabled = true;

-- 2) Grupos monitorados (quando scan_mode = selected_groups)
CREATE TABLE IF NOT EXISTS anti_spam_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES anti_spam_configs(id) ON DELETE CASCADE,
  group_jid text NOT NULL,
  group_name text NULL,
  is_monitored boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(config_id, group_jid)
);

COMMENT ON TABLE anti_spam_groups IS 'Grupos monitorados pelo Anti-Spam quando scan_mode = selected_groups';
CREATE INDEX IF NOT EXISTS idx_anti_spam_groups_config_id ON anti_spam_groups(config_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_groups_is_monitored ON anti_spam_groups(config_id, is_monitored) WHERE is_monitored = true;

-- 3) Blacklist
CREATE TABLE IF NOT EXISTS anti_spam_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES anti_spam_configs(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  wa_jid text NULL,
  reason text NOT NULL DEFAULT 'manual' CHECK (reason IN ('denuncia_grupo', 'manual', 'scan')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'whitelist_override')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  UNIQUE(config_id, phone_e164)
);

COMMENT ON TABLE anti_spam_blacklist IS 'Blacklist de números por config Anti-Spam';
CREATE INDEX IF NOT EXISTS idx_anti_spam_blacklist_config_id ON anti_spam_blacklist(config_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_blacklist_phone_e164 ON anti_spam_blacklist(config_id, phone_e164);
CREATE INDEX IF NOT EXISTS idx_anti_spam_blacklist_status ON anti_spam_blacklist(config_id, status) WHERE status = 'active';

-- 4) Cursor de processamento (idempotência por banca)
-- evolution_webhook_events usa id uuid; cursor guarda último evento processado
CREATE TABLE IF NOT EXISTS anti_spam_event_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id uuid NOT NULL UNIQUE,
  last_event_id uuid NULL,
  last_received_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anti_spam_event_cursor IS 'Cursor de eventos já processados pelo Anti-Spam por banca (evita reprocessar)';
CREATE INDEX IF NOT EXISTS idx_anti_spam_event_cursor_banca_id ON anti_spam_event_cursor(banca_id);

-- 5) Logs de ação (auditoria e idempotência)
CREATE TABLE IF NOT EXISTS anti_spam_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NULL REFERENCES anti_spam_configs(id) ON DELETE SET NULL,
  banca_id uuid NULL,
  event_id uuid NULL,
  group_jid text NULL,
  phone_e164 text NULL,
  action text NOT NULL CHECK (action IN ('remove_from_group', 'add_to_blacklist', 'delete_message')),
  result text NOT NULL CHECK (result IN ('success', 'fail', 'skipped')),
  error_message text NULL,
  meta jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE anti_spam_actions IS 'Log de ações executadas pelo Anti-Spam (remoção, blacklist, delete message)';
CREATE INDEX IF NOT EXISTS idx_anti_spam_actions_config_id ON anti_spam_actions(config_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_actions_banca_id ON anti_spam_actions(banca_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_actions_event_id ON anti_spam_actions(event_id);
CREATE INDEX IF NOT EXISTS idx_anti_spam_actions_created_at ON anti_spam_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anti_spam_actions_action_result ON anti_spam_actions(action, result);

-- Trigger updated_at para anti_spam_configs
CREATE OR REPLACE FUNCTION set_anti_spam_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_anti_spam_configs_updated_at ON anti_spam_configs;
CREATE TRIGGER trigger_anti_spam_configs_updated_at
  BEFORE UPDATE ON anti_spam_configs
  FOR EACH ROW EXECUTE PROCEDURE set_anti_spam_configs_updated_at();
