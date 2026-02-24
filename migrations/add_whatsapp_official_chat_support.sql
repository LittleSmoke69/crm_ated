-- =====================================================
-- Suporte ao WhatsApp Oficial no chat interno
-- Depende: create_chat_tables.sql, create_whatsapp_official_configs.sql
-- =====================================================

-- 1. chat_conversations: suporte a canal oficial (whatsapp_config_id)
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES public.whatsapp_official_configs(id) ON DELETE CASCADE;

-- instance_id passa a ser opcional (conversas do oficial não têm instância Evolution)
ALTER TABLE chat_conversations
    ALTER COLUMN instance_id DROP NOT NULL;

-- Remover constraint unique antiga (nome pode variar; drop por definição)
ALTER TABLE chat_conversations
    DROP CONSTRAINT IF EXISTS chat_conversations_instance_id_remote_jid_key;

-- Unicidade: Evolution por (instance_id, remote_jid); Oficial por (whatsapp_config_id, remote_jid)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_instance_remote
    ON chat_conversations (instance_id, remote_jid) WHERE instance_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_whatsapp_config_remote
    ON chat_conversations (whatsapp_config_id, remote_jid) WHERE whatsapp_config_id IS NOT NULL;

-- 2. chat_messages: provider + instance_id opcional
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evolution';

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES public.whatsapp_official_configs(id) ON DELETE SET NULL;

ALTER TABLE chat_messages
    ALTER COLUMN instance_id DROP NOT NULL;

-- Unicidade por conversa + message_id (vale para Evolution e Oficial)
ALTER TABLE chat_messages
    DROP CONSTRAINT IF EXISTS chat_messages_instance_id_message_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_conversation_message
    ON chat_messages (conversation_id, message_id);

-- Índice para buscar mensagens por external id (status updates do oficial)
CREATE INDEX IF NOT EXISTS idx_chat_messages_message_id_provider
    ON chat_messages (message_id, provider) WHERE provider = 'whatsapp_official';
