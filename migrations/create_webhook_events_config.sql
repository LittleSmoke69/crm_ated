-- =====================================================
-- Migration: Criar tabela para configuração de eventos de webhook
-- Data: 2024
-- Descrição: Armazena quais eventos estão habilitados para envio via webhook
-- =====================================================

CREATE TABLE IF NOT EXISTS webhook_events_config (
  id text PRIMARY KEY DEFAULT 'default',
  enabled_events text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE webhook_events_config IS 'Configuração de eventos habilitados para envio via webhook da Evolution API';
COMMENT ON COLUMN webhook_events_config.id IS 'ID da configuração (sempre "default")';
COMMENT ON COLUMN webhook_events_config.enabled_events IS 'Array de nomes de eventos habilitados (ex: ["MESSAGES_UPSERT", "GROUPS_UPSERT"])';
COMMENT ON COLUMN webhook_events_config.updated_at IS 'Timestamp da última atualização';

-- Insere configuração padrão com todos os eventos habilitados
INSERT INTO webhook_events_config (id, enabled_events)
VALUES ('default', ARRAY[
  'APPLICATION_STARTUP',
  'CALL',
  'CHATS_DELETE',
  'CHATS_SET',
  'CHATS_UPDATE',
  'CHATS_UPSERT',
  'CONNECTION_UPDATE',
  'CONTACTS_SET',
  'CONTACTS_UPDATE',
  'CONTACTS_UPSERT',
  'GROUPS_UPSERT',
  'GROUP_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
  'MESSAGES_DELETE',
  'MESSAGES_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGING_HISTORY_SET',
  'PRESENCE_UPDATE',
  'QRCODE_UPDATED',
  'SEND_MESSAGE',
  'TYPEWRITER',
  'UNREAD_MESSAGES'
])
ON CONFLICT (id) DO NOTHING;

