-- Disparo em massa: sequência de mensagens por contato (espelha supabase/migrations/20260515100000_*).
-- Aplique no banco onde ocorrer: "could not find the 'message_step_index' column of 'chat_broadcasts'"

ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS message_step_index integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.chat_broadcasts.message_step_index IS
  '0-based: qual mensagem de message_config.steps enviar para o contato em current_index.';
