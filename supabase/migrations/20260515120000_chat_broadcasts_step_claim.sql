-- Anti-duplicação: runner no cliente e cron `process-broadcast-queue` não podem enviar o mesmo passo em paralelo.
ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS step_claim_token uuid NULL,
  ADD COLUMN IF NOT EXISTS step_claim_at timestamptz NULL;

COMMENT ON COLUMN public.chat_broadcasts.step_claim_token IS
  'Lease por passo do disparo; null = livre. Evita envio duplicado entre process-next e worker cron.';
COMMENT ON COLUMN public.chat_broadcasts.step_claim_at IS
  'Quando o claim foi obtido; claims mais velhos que alguns minutos são liberados automaticamente.';
