-- Disparo em massa: múltiplas instâncias (rotação) + intervalo fixo ou aleatório.

ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS broadcast_instances jsonb;

ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS delay_mode text NOT NULL DEFAULT 'fixed';

ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS delay_min_seconds integer;

ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS delay_max_seconds integer;

COMMENT ON COLUMN public.chat_broadcasts.broadcast_instances IS 'Lista [{id, name}] das instâncias Evolution em rotação; null = apenas instance_id legado.';
COMMENT ON COLUMN public.chat_broadcasts.delay_mode IS 'fixed | random — intervalo entre envios.';
COMMENT ON COLUMN public.chat_broadcasts.delay_min_seconds IS 'Aleatório: mínimo (s), inclusive.';
COMMENT ON COLUMN public.chat_broadcasts.delay_max_seconds IS 'Aleatório: máximo (s), inclusive.';
