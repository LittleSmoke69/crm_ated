-- =====================================================
-- Chat Realtime — Garantir publication e REPLICA IDENTITY
-- Resolve CHANNEL_ERROR no subscribe de postgres_changes em chat_messages.
-- Executar no SQL Editor do Supabase (uma vez).
-- =====================================================

-- 1. Incluir tabelas na publication supabase_realtime (idempotente)
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

-- 2. REPLICA IDENTITY FULL para UPDATE/DELETE enviarem linha completa no Realtime
ALTER TABLE public.chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

-- 3. Garantir que RLS está desabilitado (Realtime com anon/authenticated exige SELECT;
--    se RLS estiver ativo sem política, ocorre CHANNEL_ERROR)
ALTER TABLE public.chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages DISABLE ROW LEVEL SECURITY;

-- Diagnóstico (opcional): listar tabelas na publication
-- SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename;
