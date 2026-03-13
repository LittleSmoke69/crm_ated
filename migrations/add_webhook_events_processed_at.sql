-- Marca quando o evento foi organizado nas tabelas do chat (chat_conversations + chat_messages)
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.webhook_events.processed_at IS 'Preenchido quando o raw_payload foi processado e organizado em chat_conversations/chat_messages';

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
  ON public.webhook_events (processed_at) WHERE processed_at IS NULL;

-- Habilitar Realtime para processar eventos em tempo real quando o front inscrever
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'webhook_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE webhook_events;
  END IF;
END;
$$;
