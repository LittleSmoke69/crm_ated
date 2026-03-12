-- =====================================================
-- Chat Interno — Realtime, índices e diagnóstico
-- EXECUTAR UMA ÚNICA VEZ no SQL Editor do Supabase
-- =====================================================

-- 1. Habilitar Realtime para as tabelas do chat (idempotente)
--    Adiciona cada tabela apenas se ainda não fizer parte da publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END;
$$;

-- 2. Índice para busca de mensagens órfãs (usada pelo script de migração histórica)
CREATE INDEX IF NOT EXISTS idx_chat_messages_orphan
  ON chat_messages (whatsapp_config_id, sender_jid)
  WHERE conversation_id IS NULL;

-- 3. Índice para ordenação cronológica por conversa (carregamento de histórico)
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp
  ON chat_messages (conversation_id, timestamp ASC);

-- 4. Diagnóstico: verificar quais tabelas estão na publication
--    Deve aparecer chat_conversations e chat_messages após os ALTERs acima
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
