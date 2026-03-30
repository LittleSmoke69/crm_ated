-- Homolog: Evolution webhook (auditoria) + Flow Builder (flows, execuções, instâncias, pergunta).
-- Depende: pgcrypto (01). Opcional: triggers pesados em migrations/trigger_evolution_webhook_*.sql
-- Espelha: create_evolution_webhook_tables, create_flow_builder_tables, create_flow_instances_table,
--          add_env_instance_to_flow_executions, add_flow_executions_dedup_constraint (ajustado),
--          create_flow_question_pending.

-- ---------------------------------------------------------------------------
-- 1) evolution_webhook_events + test waiters (flows e webhooks /api/webhooks/evolution)
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_fingerprint
  ON public.evolution_webhook_events (event_type, instance_name, remote_jid, received_at DESC)
  WHERE event_type IN ('group-participants.update', 'GROUP_PARTICIPANTS_UPDATE');

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

-- ---------------------------------------------------------------------------
-- 2) flows + execuções + passos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'automation' CHECK (type IN ('automation', 'template')),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'draft')),
  graph_json JSONB NOT NULL DEFAULT '{"nodes": [], "edges": []}'::jsonb,
  settings_json JSONB DEFAULT '{}'::jsonb,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_flows_user_id ON public.flows (user_id);
CREATE INDEX IF NOT EXISTS idx_flows_status ON public.flows (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flows_type ON public.flows (type);
CREATE INDEX IF NOT EXISTS idx_flows_status_user ON public.flows (user_id, status);

CREATE TABLE IF NOT EXISTS public.flow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES public.flows (id) ON DELETE CASCADE,
  trigger_event_id UUID REFERENCES public.evolution_webhook_events (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  error_message TEXT,
  input_data JSONB,
  output_data JSONB,
  user_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flow_executions_flow_id ON public.flow_executions (flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_executions_status ON public.flow_executions (status);
CREATE INDEX IF NOT EXISTS idx_flow_executions_started_at ON public.flow_executions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_executions_trigger_event ON public.flow_executions (trigger_event_id);
CREATE INDEX IF NOT EXISTS idx_flow_executions_user_id ON public.flow_executions (user_id);

ALTER TABLE public.flow_executions
  ADD COLUMN IF NOT EXISTS env TEXT,
  ADD COLUMN IF NOT EXISTS instance_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'flow_executions_env_check'
  ) THEN
    ALTER TABLE public.flow_executions
      ADD CONSTRAINT flow_executions_env_check CHECK (env IS NULL OR env IN ('prod', 'test'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flow_executions_env ON public.flow_executions (env);
CREATE INDEX IF NOT EXISTS idx_flow_executions_instance_name ON public.flow_executions (instance_name);

CREATE TABLE IF NOT EXISTS public.flow_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.flow_executions (id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  input_json JSONB,
  output_json JSONB,
  error_message TEXT,
  execution_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_flow_execution_steps_execution_id ON public.flow_execution_steps (execution_id);
CREATE INDEX IF NOT EXISTS idx_flow_execution_steps_status ON public.flow_execution_steps (status);
CREATE INDEX IF NOT EXISTS idx_flow_execution_steps_node_id ON public.flow_execution_steps (execution_id, node_id);

-- ---------------------------------------------------------------------------
-- 3) flow_instances (flow por grupo/instância)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES public.flows (id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  group_jid TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings_json JSONB DEFAULT '{}'::jsonb,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  UNIQUE (flow_id, instance_name, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_flow_instances_flow_id ON public.flow_instances (flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_instances_instance_name ON public.flow_instances (instance_name);
CREATE INDEX IF NOT EXISTS idx_flow_instances_group_jid ON public.flow_instances (group_jid);
CREATE INDEX IF NOT EXISTS idx_flow_instances_active ON public.flow_instances (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_flow_instances_user_id ON public.flow_instances (user_id);
CREATE INDEX IF NOT EXISTS idx_flow_instances_flow_active ON public.flow_instances (flow_id, is_active);

CREATE OR REPLACE FUNCTION public.update_flow_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_flow_instances_updated_at ON public.flow_instances;
CREATE TRIGGER trigger_update_flow_instances_updated_at
  BEFORE UPDATE ON public.flow_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.update_flow_instances_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Nó "Pergunta": pausa execução + status paused em flow_executions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.flow_question_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES public.flows (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  execution_id UUID NOT NULL REFERENCES public.flow_executions (id) ON DELETE CASCADE,
  instance_name TEXT,
  remote_jid TEXT NOT NULL,
  expected_sender_jid TEXT,
  question_text TEXT,
  context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'answered', 'timed_out')),
  expires_at TIMESTAMPTZ NOT NULL,
  answer_text TEXT,
  answer_event_id UUID REFERENCES public.evolution_webhook_events (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fqp_status_expires ON public.flow_question_pending (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_fqp_remote_instance ON public.flow_question_pending (remote_jid, instance_name, status)
  WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_fqp_execution ON public.flow_question_pending (execution_id);

ALTER TABLE public.flow_executions DROP CONSTRAINT IF EXISTS flow_executions_status_check;
ALTER TABLE public.flow_executions ADD CONSTRAINT flow_executions_status_check
  CHECK (status IN ('running', 'success', 'failed', 'cancelled', 'paused'));

-- ---------------------------------------------------------------------------
-- 5) Deduplicação: um flow por evento (quando trigger_event_id preenchido)
-- ---------------------------------------------------------------------------
ALTER TABLE public.flow_executions DROP CONSTRAINT IF EXISTS uq_flow_executions_flow_event;
ALTER TABLE public.flow_executions ADD CONSTRAINT uq_flow_executions_flow_event
  UNIQUE (flow_id, trigger_event_id);
