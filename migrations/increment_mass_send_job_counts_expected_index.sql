-- Evita corrida entre workers (Netlify cron + /mass-send/process): só aplica
-- incremento de contadores e avanço de processed_index se o índice esperado bater.
-- Retorna FALSE quando outra instância já avançou (persist ignorado; re-sync no app).

DROP FUNCTION IF EXISTS public.increment_mass_send_job_counts(UUID, INT, INT, INT, TEXT, TEXT, TIMESTAMPTZ, JSONB);

CREATE OR REPLACE FUNCTION public.increment_mass_send_job_counts(
  p_job_id UUID,
  p_sent INT,
  p_failed INT,
  p_processed_index INT,
  p_expected_processed_index INT,
  p_last_error TEXT,
  p_status TEXT,
  p_now TIMESTAMPTZ,
  p_group_outcomes JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INT;
BEGIN
  UPDATE public.activation_mass_send_jobs
  SET
    sent_count = sent_count + p_sent,
    failed_count = failed_count + p_failed,
    processed_index = p_processed_index,
    last_error = p_last_error,
    status = p_status,
    locked_at = CASE
      WHEN p_status = 'completed' THEN NULL
      ELSE p_now
    END,
    locked_by = CASE
      WHEN p_status = 'completed' THEN NULL
      ELSE locked_by
    END,
    updated_at = p_now,
    group_results = CASE
      WHEN p_group_outcomes IS NOT NULL
        AND jsonb_typeof(p_group_outcomes) = 'array'
        AND jsonb_array_length(p_group_outcomes) > 0
      THEN COALESCE(group_results, '[]'::jsonb) || p_group_outcomes
      ELSE group_results
    END
  WHERE id = p_job_id
    AND processed_index = p_expected_processed_index;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count = 0 THEN
    RETURN FALSE;
  END IF;

  IF p_group_outcomes IS NOT NULL
     AND jsonb_typeof(p_group_outcomes) = 'array'
     AND jsonb_array_length(p_group_outcomes) > 0
  THEN
    INSERT INTO public.activation_mass_send_job_groups (job_id, group_id, success, error_message, created_at, updated_at)
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
      success = EXCLUDED.success,
      error_message = EXCLUDED.error_message,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_mass_send_job_counts(UUID, INT, INT, INT, INT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_mass_send_job_counts(UUID, INT, INT, INT, INT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;
