-- =====================================================
-- Janela de 24h do WhatsApp Oficial nas conversas
-- Depende: add_whatsapp_official_chat_support.sql
-- A conversa é identificada pelo telefone (remote_jid); eventos
-- de mensagem são agrupados nela. A janela de 24h começa na
-- última mensagem recebida do contato (ou na nossa resposta).
-- =====================================================

-- Última mensagem recebida do contato: usada para saber se ainda
-- podemos enviar mensagem livre (dentro de 24h) ou só template.
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ;

COMMENT ON COLUMN chat_conversations.last_customer_message_at IS
    'Timestamp da última mensagem recebida do contato (WhatsApp Oficial). Usado para janela de 24h: dentro dela pode enviar texto livre; fora, apenas templates.';

CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_customer_message_at
    ON chat_conversations (last_customer_message_at DESC)
    WHERE whatsapp_config_id IS NOT NULL;
