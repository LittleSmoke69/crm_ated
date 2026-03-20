-- Espera de resposta em nó "Pergunta" (flows): pausa execução até mensagem ou timeout
-- Executar no Supabase SQL Editor após revisão.

CREATE TABLE IF NOT EXISTS flow_question_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  node_id text NOT NULL,
  execution_id uuid NOT NULL REFERENCES flow_executions(id) ON DELETE CASCADE,
  instance_name text,
  remote_jid text NOT NULL,
  expected_sender_jid text,
  question_text text,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'answered', 'timed_out')),
  expires_at timestamptz NOT NULL,
  answer_text text,
  answer_event_id uuid REFERENCES evolution_webhook_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fqp_status_expires ON flow_question_pending (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_fqp_remote_instance ON flow_question_pending (remote_jid, instance_name, status) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_fqp_execution ON flow_question_pending (execution_id);

COMMENT ON TABLE flow_question_pending IS 'Fluxo pausado aguardando resposta ao nó pergunta (WhatsApp)';
COMMENT ON COLUMN flow_question_pending.context_snapshot IS 'Contexto serializado para retomar o grafo após resposta ou timeout';

-- Permite execução pausada aguardando pergunta
ALTER TABLE flow_executions DROP CONSTRAINT IF EXISTS flow_executions_status_check;
ALTER TABLE flow_executions ADD CONSTRAINT flow_executions_status_check
  CHECK (status IN ('running', 'success', 'failed', 'cancelled', 'paused'));

COMMENT ON COLUMN flow_executions.status IS 'running | success | failed | cancelled | paused (aguardando resposta pergunta)';

-- Timeouts "Tempo esgotado" do nó Pergunta: chamar GET/POST /api/internal/cron/flow-question-timeouts com CRON_SECRET.
-- Recomendado: **a cada 1 segundo** (cron externo ou FLOW_QUESTION_POLL_ENABLED=true em processo único).
-- Netlify Scheduled Functions: no máximo ~1/minuto (ver netlify.toml + netlify/functions/flow-question-timeouts.ts).
