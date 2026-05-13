-- Disparo em massa: índice da mensagem atual na sequência (por contato).

ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS message_step_index integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.chat_broadcasts.message_step_index IS
  '0-based: qual mensagem de message_config.steps enviar para o contato em current_index.';
