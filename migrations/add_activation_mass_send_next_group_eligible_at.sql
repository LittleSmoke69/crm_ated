-- Pausa entre grupos sem bloquear a requisição HTTP por minutos (evita timeout do gateway).
-- O worker grava o instante em que o próximo envio é permitido e encerra; chain/cron reentra depois.

ALTER TABLE public.activation_mass_send_jobs
  ADD COLUMN IF NOT EXISTS next_group_eligible_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.activation_mass_send_jobs.next_group_eligible_at IS
  'Se não nulo e no futuro, o worker não envia o grupo em processed_index até esse horário (delay entre grupos fora do sleep na request).';
