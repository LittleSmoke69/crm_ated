-- Resultados por grupo nas campanhas de disparo em massa (sucesso/falha + erro).
-- Permite exibir quais grupos falharam e reenviar apenas para eles.

ALTER TABLE activation_mass_send_jobs
  ADD COLUMN IF NOT EXISTS group_results jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN activation_mass_send_jobs.group_results IS
  'Array JSON: [{ "groupId": "...", "success": true|false, "error": "..." }] acumulado por lote';

CREATE OR REPLACE FUNCTION increment_mass_send_job_counts(
  p_job_id          UUID,
  p_sent            INT,
  p_failed          INT,
  p_processed_index INT,
  p_last_error      TEXT,
  p_status          TEXT,
  p_now             TIMESTAMPTZ,
  p_group_outcomes  JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE activation_mass_send_jobs
  SET
    sent_count       = sent_count + p_sent,
    failed_count     = failed_count + p_failed,
    processed_index  = p_processed_index,
    last_error       = p_last_error,
    status           = p_status,
    locked_at        = NULL,
    locked_by        = NULL,
    updated_at       = p_now,
    group_results    = CASE
      WHEN p_group_outcomes IS NOT NULL
           AND jsonb_typeof(p_group_outcomes) = 'array'
           AND jsonb_array_length(p_group_outcomes) > 0
      THEN COALESCE(group_results, '[]'::jsonb) || p_group_outcomes
      ELSE group_results
    END
  WHERE id = p_job_id;
END;
$$;
