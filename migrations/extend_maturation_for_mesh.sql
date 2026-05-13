-- ============================================
-- MATURADOR MESH UNIFICADO
-- ============================================
-- Estende o sistema de maturação existente para suportar campanhas mesh contínuas:
-- - 1 job marcado como "controller" guarda o estado da campanha (intervalo, ciclo, próximo tick)
-- - N jobs participantes (1 por instância) compartilham o mesmo campaign_id
-- - Cada ciclo, o processor sorteia 1-5 remetentes e injeta steps com sender por step
-- - Substitui o auto-maturador (state machine de fases) pelo loop mesh

-- ----------------------------------------------------------------
-- 1) Estado da campanha mesh (no job controller)
-- ----------------------------------------------------------------
ALTER TABLE maturation_jobs
  ADD COLUMN IF NOT EXISTS mesh_is_controller BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mesh_cycle_interval_sec INTEGER NULL,
  ADD COLUMN IF NOT EXISTS mesh_cycle_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mesh_next_cycle_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS mesh_last_sender_master_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN maturation_jobs.mesh_is_controller IS
  'true = job controlador da campanha mesh (guarda intervalo/contador/próximo ciclo). false = job participante normal.';
COMMENT ON COLUMN maturation_jobs.mesh_cycle_interval_sec IS
  'Intervalo entre ciclos do mesh em segundos (padrão 30, editável pelo usuário). NULL nos jobs não-controller.';
COMMENT ON COLUMN maturation_jobs.mesh_cycle_count IS
  'Quantos ciclos já rodaram nesta campanha mesh.';
COMMENT ON COLUMN maturation_jobs.mesh_next_cycle_at IS
  'Quando o próximo ciclo deve rodar. O processor procura controllers com este campo <= NOW().';
COMMENT ON COLUMN maturation_jobs.mesh_last_sender_master_ids IS
  'IDs (master_instances) dos remetentes do último ciclo. Usado para garantir distribuição equitativa: nenhuma instância fica fora por mais de 1 ciclo.';

-- Índice rápido pro scheduler do mesh
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_mesh_next_cycle
  ON maturation_jobs(mesh_next_cycle_at)
  WHERE mesh_is_controller = true AND status = 'running';

-- Partial unique index: garante NO MÁXIMO um controller mesh ativo (running ou paused) no sistema.
-- Evita race condition em Starts simultâneos. Se o INSERT viola, o código capta e faz JOIN
-- na campanha existente. Status finalizado (finished/failed/aborted) não conta — permite histórico.
CREATE UNIQUE INDEX IF NOT EXISTS idx_maturation_jobs_mesh_singleton_controller
  ON maturation_jobs ((true))
  WHERE mesh_is_controller = true AND status IN ('running', 'paused');

-- ----------------------------------------------------------------
-- 2) Sender por step (override do master_instance_id do job)
-- ----------------------------------------------------------------
-- Em campanhas mesh, cada step pode ter um remetente diferente (sorteado por ciclo),
-- então o sender precisa ser por step, não por job.
ALTER TABLE maturation_steps
  ADD COLUMN IF NOT EXISTS sender_master_instance_id UUID NULL REFERENCES master_instances(id) ON DELETE SET NULL;

COMMENT ON COLUMN maturation_steps.sender_master_instance_id IS
  'Override do remetente (master_instances.id) para este step. Se NULL, usa mj.master_instance_id (jobs tradicionais). Em mesh, cada step define seu próprio sender.';

CREATE INDEX IF NOT EXISTS idx_maturation_steps_sender
  ON maturation_steps(sender_master_instance_id)
  WHERE sender_master_instance_id IS NOT NULL;

-- ----------------------------------------------------------------
-- 3) RPC claim_maturation_steps com suporte a sender por step
-- ----------------------------------------------------------------
-- Mantém todas as proteções da última versão (plano ativo, master/evolution/api válidos)
-- e adiciona COALESCE(ms.sender_master_instance_id, mj.master_instance_id) na resolução
-- do remetente. Assim jobs tradicionais continuam funcionando sem alteração.
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
  WITH eligible AS (
    SELECT ms2.id AS step_id
    FROM maturation_steps ms2
    INNER JOIN maturation_jobs mj2 ON ms2.job_id = mj2.id
    INNER JOIN maturation_plans mp ON mj2.plan_id = mp.id AND mp.is_active = true
    INNER JOIN master_instances mi
      ON mi.id = COALESCE(ms2.sender_master_instance_id, mj2.master_instance_id)
      AND mi.is_active = true
    INNER JOIN evolution_instances ei ON mi.evolution_instance_id = ei.id
    INNER JOIN evolution_apis ea ON ei.evolution_api_id = ea.id
    WHERE ms2.status = 'pending'
      AND ms2.scheduled_at <= NOW()
      AND mj2.status = 'running'
    ORDER BY ms2.scheduled_at ASC
    LIMIT claim_limit
    FOR UPDATE OF ms2 SKIP LOCKED
  ),
  claimed AS (
    UPDATE maturation_steps ms
    SET
      status = 'processing',
      locked_at = NOW(),
      locked_by = COALESCE(NULLIF(current_setting('app.worker_id', true), ''), 'maturation-worker'),
      updated_at = NOW()
    FROM maturation_jobs mj
    WHERE ms.job_id = mj.id
      AND ms.id IN (SELECT step_id FROM eligible)
    RETURNING
      ms.id,
      ms.job_id,
      ms.step_index,
      ms.type,
      ms.payload_json,
      ms.scheduled_at,
      ms.attempts,
      ms.max_attempts,
      COALESCE(ms.sender_master_instance_id, mj.master_instance_id) AS resolved_master_instance_id,
      mj.target_chat_id AS job_target_chat_id,
      ms.target_chat_id AS step_target_chat_id
  )
  SELECT
    c.id,
    c.job_id,
    c.step_index,
    c.type,
    c.payload_json,
    c.scheduled_at,
    c.attempts,
    c.max_attempts,
    c.resolved_master_instance_id AS master_instance_id,
    ei.instance_name,
    ea.base_url,
    ea.api_key_global AS api_key,
    COALESCE(c.step_target_chat_id, c.job_target_chat_id) AS target_chat_id
  FROM claimed c
  INNER JOIN master_instances mi ON c.resolved_master_instance_id = mi.id AND mi.is_active = true
  INNER JOIN evolution_instances ei ON mi.evolution_instance_id = ei.id
  INNER JOIN evolution_apis ea ON ei.evolution_api_id = ea.id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_maturation_steps IS
  'Reivindica steps pendentes (plano ativo + master/evolution/api válidos). Suporta sender por step via maturation_steps.sender_master_instance_id (override do master_instance_id do job, usado em campanhas mesh).';
