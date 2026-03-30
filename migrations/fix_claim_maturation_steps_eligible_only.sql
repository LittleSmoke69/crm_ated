-- Só reivindica (UPDATE → processing) steps que já passam na cadeia master_instances + evolution_instances + evolution_apis.
-- Antes: o UPDATE marcava processing e o SELECT final podia não retornar linha (JOIN falha → api/instance ausente),
-- deixando steps presos em processing sem nunca chamar a Evolution API.

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
    INNER JOIN master_instances mi ON mj2.master_instance_id = mi.id AND mi.is_active = true
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
      mj.master_instance_id,
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
    c.master_instance_id,
    ei.instance_name,
    ea.base_url,
    ea.api_key_global AS api_key,
    COALESCE(c.step_target_chat_id, c.job_target_chat_id) AS target_chat_id
  FROM claimed c
  INNER JOIN master_instances mi ON c.master_instance_id = mi.id AND mi.is_active = true
  INNER JOIN evolution_instances ei ON mi.evolution_instance_id = ei.id
  INNER JOIN evolution_apis ea ON ei.evolution_api_id = ea.id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_maturation_steps IS
  'Reivindica steps pendentes apenas se master_instance + evolution_instance + evolution_api existirem (evita processing órfão sem envio).';
