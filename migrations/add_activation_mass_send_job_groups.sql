-- Estrutura relacional para resultado por grupo (sucesso/falha + mensagem).
-- Complementa group_results (jsonb) com consultas indexadas e histórico claro de falhas.

CREATE TABLE IF NOT EXISTS activation_mass_send_job_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES activation_mass_send_jobs(id) ON DELETE CASCADE,
  group_id text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_amsg_job_groups_job_id
  ON activation_mass_send_job_groups(job_id);

CREATE INDEX IF NOT EXISTS idx_amsg_job_groups_failed
  ON activation_mass_send_job_groups(job_id)
  WHERE success = false;

COMMENT ON TABLE activation_mass_send_job_groups IS
  'Uma linha por grupo (JID) por campanha: sucesso/falha e texto de erro para reenvio e relatórios.';

ALTER TABLE activation_mass_send_job_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view activation_mass_send_job_groups for own jobs"
  ON activation_mass_send_job_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM activation_mass_send_jobs j
      WHERE j.id = activation_mass_send_job_groups.job_id
        AND j.user_id = auth.uid()
    )
  );

-- Writes via service role / SECURITY DEFINER; sem INSERT para cliente autenticado direto.

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
SET search_path = public
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

  IF p_group_outcomes IS NOT NULL
     AND jsonb_typeof(p_group_outcomes) = 'array'
     AND jsonb_array_length(p_group_outcomes) > 0
  THEN
    INSERT INTO activation_mass_send_job_groups (job_id, group_id, success, error_message, created_at, updated_at)
    SELECT
      p_job_id,
      NULLIF(TRIM(COALESCE(elem->>'groupId', elem->>'group_id')), ''),
      COALESCE((elem->>'success')::boolean, false),
      NULLIF(TRIM(elem->>'error'), ''),
      p_now,
      p_now
    FROM jsonb_array_elements(p_group_outcomes) AS t(elem)
    WHERE NULLIF(TRIM(COALESCE(elem->>'groupId', elem->>'group_id')), '') IS NOT NULL
    ON CONFLICT (job_id, group_id) DO UPDATE SET
      success       = EXCLUDED.success,
      error_message = EXCLUDED.error_message,
      updated_at    = EXCLUDED.updated_at;
  END IF;
END;
$$;
