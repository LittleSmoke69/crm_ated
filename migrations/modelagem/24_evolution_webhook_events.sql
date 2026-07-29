-- Modelagem 24 — Eventos de webhook Evolution (chat interno / auditoria)
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.evolution_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  env TEXT NOT NULL CHECK (env IN ('prod', 'test')),
  event_type TEXT NOT NULL,
  instance_name TEXT,
  remote_jid TEXT,
  message_id TEXT,
  payload JSONB NOT NULL
);

ALTER TABLE public.evolution_webhook_events
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.evolution_webhook_events
  ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES public.zaploto_tenants (id) ON DELETE SET NULL;

ALTER TABLE public.evolution_webhook_events
  ADD COLUMN IF NOT EXISTS payload_normalized JSONB;

ALTER TABLE public.evolution_webhook_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_received_at
  ON public.evolution_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_event_type
  ON public.evolution_webhook_events (event_type);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_instance_name
  ON public.evolution_webhook_events (instance_name);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_env
  ON public.evolution_webhook_events (env);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_webhook_events_instance_message_unique
  ON public.evolution_webhook_events (instance_name, message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_chat_pending
  ON public.evolution_webhook_events (instance_name, received_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.evolution_webhook_test_waiters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'received', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  received_event_id UUID REFERENCES public.evolution_webhook_events (id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ,
  env TEXT NOT NULL DEFAULT 'test' CHECK (env IN ('test', 'prod'))
);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_test_waiters_status
  ON public.evolution_webhook_test_waiters (status);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_test_waiters_expires_at
  ON public.evolution_webhook_test_waiters (expires_at);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_test_waiters_active
  ON public.evolution_webhook_test_waiters (status, expires_at, env)
  WHERE status = 'waiting';

-- Realtime (ignora se já estiver na publication)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.evolution_webhook_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- Marca instâncias mestres existentes como chat (necessário para o pipeline)
UPDATE public.evolution_instances
SET is_chat_instance = true
WHERE is_master = true
  AND COALESCE(is_chat_instance, false) = false;
