-- Target Chat ID opcional no job e por step no fluxo
-- Permite: maturador envia para instâncias; no meio do fluxo, steps podem enviar para um grupo (target_chat_id no step).

-- 1) Job: target_chat_id passa a ser opcional
ALTER TABLE maturation_jobs
  ALTER COLUMN target_chat_id DROP NOT NULL;

COMMENT ON COLUMN maturation_jobs.target_chat_id IS 'Chat de destino padrão (grupo ou número). Opcional; steps podem ter target_chat_id próprio para "enviar no grupo" no meio do fluxo.';

-- 2) Step: target_chat_id opcional (quando preenchido, envia para esse grupo no meio do fluxo)
ALTER TABLE maturation_steps
  ADD COLUMN IF NOT EXISTS target_chat_id TEXT NULL;

COMMENT ON COLUMN maturation_steps.target_chat_id IS 'Quando preenchido, este step envia para este grupo. Caso contrário, usa o target_chat_id do job (se houver).';

-- 3) RPC claim_maturation_steps: retornar COALESCE(step.target_chat_id, job.target_chat_id)
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
      mj.target_chat_id AS job_target_chat_id,
      ms.target_chat_id AS step_target_chat_id
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
    COALESCE(cs.step_target_chat_id, cs.job_target_chat_id) AS target_chat_id
  FROM claimed_steps cs
  INNER JOIN master_instances mi ON cs.master_instance_id = mi.id
  INNER JOIN evolution_instances ei ON mi.evolution_instance_id = ei.id
  INNER JOIN evolution_apis ea ON ei.evolution_api_id = ea.id
  WHERE mi.is_active = true;
END;
$$ LANGUAGE plpgsql;
