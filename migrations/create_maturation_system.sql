-- ============================================
-- SISTEMA DE MATURAÇÃO DE INSTÂNCIAS MESTRE
-- ============================================
-- Este sistema permite executar diagnósticos/maturação em instâncias mestre
-- usando requests para a Evolution API, com suporte a maturação manual e agendada.

-- Tabela: master_instances
-- Armazena instâncias marcadas como mestre que podem ser usadas para maturação
CREATE TABLE IF NOT EXISTS master_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_instance_id UUID NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  locked_job_id UUID NULL,
  locked_at TIMESTAMPTZ NULL,
  health_score INTEGER NOT NULL DEFAULT 100 CHECK (health_score >= 0 AND health_score <= 100),
  last_seen_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(evolution_instance_id)
);

-- Índices para master_instances
CREATE INDEX IF NOT EXISTS idx_master_instances_evolution_instance_id ON master_instances(evolution_instance_id);
CREATE INDEX IF NOT EXISTS idx_master_instances_is_active ON master_instances(is_active);
CREATE INDEX IF NOT EXISTS idx_master_instances_is_locked ON master_instances(is_locked);
CREATE INDEX IF NOT EXISTS idx_master_instances_locked_job_id ON master_instances(locked_job_id);
CREATE INDEX IF NOT EXISTS idx_master_instances_health_score ON master_instances(health_score);

-- Tabela: maturation_plans
-- Armazena planos de maturação com steps configurados
CREATE TABLE IF NOT EXISTS maturation_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  steps_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array de steps: [{type: 'text'|'video', delaySec: number, payload: {...}}]
  default_target_chat_id TEXT NULL, -- Grupo/chat de teste padrão (ex: 1203...@g.us)
  created_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para maturation_plans
CREATE INDEX IF NOT EXISTS idx_maturation_plans_is_active ON maturation_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_maturation_plans_created_by ON maturation_plans(created_by);

-- Tabela: maturation_jobs
-- Armazena jobs de maturação (execuções de planos)
CREATE TABLE IF NOT EXISTS maturation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES maturation_plans(id) ON DELETE RESTRICT,
  master_instance_id UUID NOT NULL REFERENCES master_instances(id) ON DELETE RESTRICT,
  target_chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'finished', 'failed', 'aborted')),
  progress_total INTEGER NOT NULL DEFAULT 0,
  progress_done INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  ended_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para maturation_jobs
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_owner_user_id ON maturation_jobs(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_plan_id ON maturation_jobs(plan_id);
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_master_instance_id ON maturation_jobs(master_instance_id);
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_status ON maturation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_created_at ON maturation_jobs(created_at DESC);

-- Tabela: maturation_steps
-- Armazena steps individuais de cada job
CREATE TABLE IF NOT EXISTS maturation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES maturation_jobs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'video')),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- text: {text: string}, video: {assetPath: string, assetId: string, caption?: string}
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL, -- Ex: netlify function id
  sent_at TIMESTAMPTZ NULL,
  latency_ms INTEGER NULL,
  http_status INTEGER NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, step_index)
);

-- Índices para maturation_steps
CREATE INDEX IF NOT EXISTS idx_maturation_steps_job_id ON maturation_steps(job_id);
CREATE INDEX IF NOT EXISTS idx_maturation_steps_scheduled_at ON maturation_steps(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_maturation_steps_status ON maturation_steps(status);
CREATE INDEX IF NOT EXISTS idx_maturation_steps_job_status ON maturation_steps(job_id, status);
-- Índice composto para claim (idempotência)
CREATE INDEX IF NOT EXISTS idx_maturation_steps_claim ON maturation_steps(scheduled_at, status) 
  WHERE status = 'pending';

-- Tabela: maturation_messages
-- Armazena mensagens do feed (estilo WhatsApp) para UI
CREATE TABLE IF NOT EXISTS maturation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES maturation_jobs(id) ON DELETE CASCADE,
  step_id UUID NULL REFERENCES maturation_steps(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  direction TEXT NOT NULL CHECK (direction IN ('system', 'instance')),
  instance_label TEXT NULL, -- Ex: instance_name
  type TEXT NOT NULL CHECK (type IN ('text', 'video', 'info', 'error', 'retry')),
  title TEXT NULL,
  content TEXT NULL,
  media_url TEXT NULL,
  status TEXT NULL CHECK (status IN ('sent', 'failed', 'retrying', 'info')),
  latency_ms INTEGER NULL,
  http_status INTEGER NULL,
  error TEXT NULL
);

-- Índices para maturation_messages
CREATE INDEX IF NOT EXISTS idx_maturation_messages_job_id ON maturation_messages(job_id);
CREATE INDEX IF NOT EXISTS idx_maturation_messages_step_id ON maturation_messages(step_id);
CREATE INDEX IF NOT EXISTS idx_maturation_messages_created_at ON maturation_messages(job_id, created_at DESC);

-- Triggers para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_master_instances_updated_at
  BEFORE UPDATE ON master_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_maturation_plans_updated_at
  BEFORE UPDATE ON maturation_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_maturation_jobs_updated_at
  BEFORE UPDATE ON maturation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_update_maturation_steps_updated_at
  BEFORE UPDATE ON maturation_steps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RPC: claim_maturation_steps
-- ============================================
-- Função idempotente para claim de steps pendentes
-- Usa FOR UPDATE SKIP LOCKED para evitar duplicidade mesmo com retries
CREATE OR REPLACE FUNCTION claim_maturation_steps(claim_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  id UUID,
  job_id UUID,
  step_index INTEGER,
  type TEXT,
  payload_json JSONB,
  scheduled_at TIMESTAMPTZ,
  attempts INTEGER,
  max_attempts INTEGER,
  master_instance_id UUID,
  instance_name TEXT,
  base_url TEXT,
  api_key TEXT,
  target_chat_id TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH claimed_steps AS (
    UPDATE maturation_steps ms
    SET 
      status = 'processing',
      locked_at = NOW(),
      locked_by = current_setting('app.worker_id', true)::TEXT,
      updated_at = NOW()
    FROM maturation_jobs mj
    WHERE ms.job_id = mj.id
      AND ms.status = 'pending'
      AND ms.scheduled_at <= NOW()
      AND mj.status = 'running'
      AND ms.id IN (
        SELECT ms2.id
        FROM maturation_steps ms2
        INNER JOIN maturation_jobs mj2 ON ms2.job_id = mj2.id
        WHERE ms2.status = 'pending'
          AND ms2.scheduled_at <= NOW()
          AND mj2.status = 'running'
        ORDER BY ms2.scheduled_at ASC
        LIMIT claim_limit
        FOR UPDATE SKIP LOCKED
      )
    RETURNING 
      ms.id,
      ms.job_id,
      ms.step_index,
      ms.type,
      ms.payload_json,
      ms.scheduled_at,
      ms.attempts,
      ms.max_attempts,
      mj.master_instance_id,
      mj.target_chat_id
  )
  SELECT 
    cs.id,
    cs.job_id,
    cs.step_index,
    cs.type,
    cs.payload_json,
    cs.scheduled_at,
    cs.attempts,
    cs.max_attempts,
    cs.master_instance_id,
    ei.instance_name,
    ea.base_url,
    ea.api_key_global AS api_key,
    cs.target_chat_id
  FROM claimed_steps cs
  INNER JOIN master_instances mi ON cs.master_instance_id = mi.id
  INNER JOIN evolution_instances ei ON mi.evolution_instance_id = ei.id
  INNER JOIN evolution_apis ea ON ei.evolution_api_id = ea.id
  WHERE mi.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS (Row Level Security)
-- ============================================

-- master_instances: apenas admins podem gerenciar
ALTER TABLE master_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access master instances"
  ON master_instances FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can view active master instances"
  ON master_instances FOR SELECT
  TO authenticated
  USING (is_active = true);

-- maturation_plans: usuários veem planos ativos, admins veem todos
ALTER TABLE maturation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access maturation plans"
  ON maturation_plans FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can view active plans"
  ON maturation_plans FOR SELECT
  TO authenticated
  USING (is_active = true);

-- maturation_jobs: usuários veem apenas seus próprios jobs
ALTER TABLE maturation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access maturation jobs"
  ON maturation_jobs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view own jobs"
  ON maturation_jobs FOR SELECT
  TO authenticated
  USING (auth.uid()::text = owner_user_id::text);

-- maturation_steps: acesso via job (herda permissão do job)
ALTER TABLE maturation_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access maturation steps"
  ON maturation_steps FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view steps of own jobs"
  ON maturation_steps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM maturation_jobs mj
      WHERE mj.id = maturation_steps.job_id
        AND mj.owner_user_id::text = auth.uid()::text
    )
  );

-- maturation_messages: acesso via job (herda permissão do job)
ALTER TABLE maturation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access maturation messages"
  ON maturation_messages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view messages of own jobs"
  ON maturation_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM maturation_jobs mj
      WHERE mj.id = maturation_messages.job_id
        AND mj.owner_user_id::text = auth.uid()::text
    )
  );

-- ============================================
-- COMENTÁRIOS
-- ============================================
COMMENT ON TABLE master_instances IS 'Instâncias mestre disponíveis para maturação';
COMMENT ON TABLE maturation_plans IS 'Planos de maturação com steps configurados';
COMMENT ON TABLE maturation_jobs IS 'Jobs de maturação (execuções de planos)';
COMMENT ON TABLE maturation_steps IS 'Steps individuais de cada job';
COMMENT ON TABLE maturation_messages IS 'Mensagens do feed para UI estilo WhatsApp';
COMMENT ON FUNCTION claim_maturation_steps IS 'Função idempotente para claim de steps pendentes usando FOR UPDATE SKIP LOCKED';

