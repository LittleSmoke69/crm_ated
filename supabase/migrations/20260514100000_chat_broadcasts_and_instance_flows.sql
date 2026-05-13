-- Disparo em massa (chat atendimento) + vínculo flow por instância Evolution.
-- Espelha migrations/add_chat_agent_and_broadcast.sql + last_sent_at (process-next).

CREATE TABLE IF NOT EXISTS public.chat_instance_flows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.evolution_instances(id) ON DELETE CASCADE,
  flow_id     uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_instance_flows_instance
  ON public.chat_instance_flows (instance_id)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.chat_broadcasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  instance_id     uuid NOT NULL REFERENCES public.evolution_instances(id) ON DELETE CASCADE,
  instance_name   text NOT NULL,
  title           text,
  message_config  jsonb NOT NULL,
  contacts        jsonb NOT NULL,
  total_count     int  NOT NULL DEFAULT 0,
  current_index   int  NOT NULL DEFAULT 0,
  delay_seconds   int  NOT NULL DEFAULT 30,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  started_at      timestamptz,
  completed_at    timestamptz,
  last_error      text,
  last_sent_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_broadcasts ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_user
  ON public.chat_broadcasts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_active
  ON public.chat_broadcasts (status)
  WHERE status IN ('pending','running','paused');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_broadcasts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_broadcasts;
  END IF;
END $$;
