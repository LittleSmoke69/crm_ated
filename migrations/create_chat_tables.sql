-- Migração para implementar o Chat Interno Zaploto

-- 1. Atualizar evolution_apis para incluir api_key_global
ALTER TABLE evolution_apis ADD COLUMN IF NOT EXISTS api_key_global TEXT;

-- Migrar api_key atual para api_key_global (se api_key_global estiver vazio)
UPDATE evolution_apis SET api_key_global = api_key WHERE api_key_global IS NULL;

-- 2. Atualizar evolution_instances para incluir campos de chat e webhook
ALTER TABLE evolution_instances ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE evolution_instances ADD COLUMN IF NOT EXISTS webhook_configured BOOLEAN DEFAULT FALSE;
ALTER TABLE evolution_instances ADD COLUMN IF NOT EXISTS is_chat_instance BOOLEAN DEFAULT FALSE;

-- 3. Criar tabela de conversas
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID,
    user_id UUID REFERENCES profiles(id),
    instance_id UUID REFERENCES evolution_instances(id) ON DELETE CASCADE,
    remote_jid TEXT NOT NULL,
    title TEXT,
    is_group BOOLEAN DEFAULT FALSE,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_preview TEXT,
    unread_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(instance_id, remote_jid)
);

-- 4. Criar tabela de mensagens
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID,
    user_id UUID REFERENCES profiles(id),
    instance_id UUID REFERENCES evolution_instances(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    direction TEXT CHECK (direction IN ('in', 'out')),
    from_me BOOLEAN DEFAULT FALSE,
    sender_jid TEXT,
    text TEXT,
    media_type TEXT, -- 'text', 'image', 'video', 'audio', 'document'
    media_url TEXT,
    caption TEXT,
    status TEXT DEFAULT 'pending', -- pending, sent, delivered, read, failed
    timestamp BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(instance_id, message_id)
);

-- 5. Adicionar índices para performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_instance_id ON chat_conversations(instance_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_workspace_id ON chat_conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace_id ON chat_messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_instance_id_remote_jid ON chat_messages(instance_id, sender_jid);

-- 6. Habilitar Realtime para as novas tabelas (Supabase)
-- Nota: Isso precisa ser executado no painel do Supabase ou via comando específico
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
-- ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- 7. Função RPC para incrementar contador de não lidas
CREATE OR REPLACE FUNCTION increment_unread_count(conv_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE chat_conversations
    SET unread_count = unread_count + 1
    WHERE id = conv_id;
END;
$$ LANGUAGE plpgsql;

