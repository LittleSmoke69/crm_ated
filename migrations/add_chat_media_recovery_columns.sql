-- Endurece o fluxo de mídia do WhatsApp Oficial.
-- Persiste os metadados necessários para recuperação de mídia sem varrer webhook_events.
-- Não altera o bucket chat-media: já é público com policies de leitura para
-- authenticated e anon desde create_chat_media_storage.sql.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS provider_media_id TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_recovery_status TEXT,
  ADD COLUMN IF NOT EXISTS media_recovery_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chat_messages_provider_media_id
  ON public.chat_messages (provider_media_id)
  WHERE provider_media_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
