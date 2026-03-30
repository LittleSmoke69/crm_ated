-- Homolog: jobs de disparo em massa (ativações) + grupos + RPC atômica (increment_mass_send_job_counts)

CREATE TABLE IF NOT EXISTS public.activation_mass_send_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  message_title TEXT,
  group_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  total_groups INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  processed_index INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.activation_mass_send_jobs
  ADD COLUMN IF NOT EXISTS group_results JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.activation_mass_send_jobs
  ADD COLUMN IF NOT EXISTS inter_group_delay_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.activation_mass_send_jobs
  DROP CONSTRAINT IF EXISTS activation_mass_send_jobs_status_check;

ALTER TABLE public.activation_mass_send_jobs
  ADD CONSTRAINT activation_mass_send_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'paused', 'completed', 'failed', 'canceled'));

CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_status ON public.activation_mass_send_jobs (status);
CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_user ON public.activation_mass_send_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_created ON public.activation_mass_send_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activation_mass_send_jobs_pending
  ON public.activation_mass_send_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

COMMENT ON COLUMN public.activation_mass_send_jobs.group_results IS 'Histórico JSON de resultados por grupo (compatível com RPC)';
COMMENT ON COLUMN public.activation_mass_send_jobs.inter_group_delay_ms IS 'Espera em ms entre envios (0–15000 na API)';

CREATE TABLE IF NOT EXISTS public.activation_mass_send_job_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.activation_mass_send_jobs (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_amsg_job_groups_job_id ON public.activation_mass_send_job_groups (job_id);
CREATE INDEX IF NOT EXISTS idx_amsg_job_groups_failed
  ON public.activation_mass_send_job_groups (job_id)
  WHERE success = false;

CREATE INDEX IF NOT EXISTS idx_amsg_job_groups_job_id_success_true
  ON public.activation_mass_send_job_groups (job_id, group_id)
  WHERE success = true;

ALTER TABLE public.activation_mass_send_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own activation_mass_send_jobs" ON public.activation_mass_send_jobs;
DROP POLICY IF EXISTS "Users can insert own activation_mass_send_jobs" ON public.activation_mass_send_jobs;

CREATE POLICY "Users can view own activation_mass_send_jobs"
  ON public.activation_mass_send_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activation_mass_send_jobs"
  ON public.activation_mass_send_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.activation_mass_send_job_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view activation_mass_send_job_groups for own jobs" ON public.activation_mass_send_job_groups;

CREATE POLICY "Users can view activation_mass_send_job_groups for own jobs"
  ON public.activation_mass_send_job_groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.activation_mass_send_jobs j
      WHERE j.id = activation_mass_send_job_groups.job_id
        AND j.user_id = auth.uid()
    )
  );

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

COMMENT ON FUNCTION public.increment_mass_send_job_counts(UUID, INT, INT, INT, INT, TEXT, TEXT, TIMESTAMPTZ, JSONB) IS
  'CAS em processed_index; p_group_outcomes NULL + p_sent/p_failed 0 = só avança índice (skip idempotente).';

GRANT EXECUTE ON FUNCTION public.increment_mass_send_job_counts(UUID, INT, INT, INT, INT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_mass_send_job_counts(UUID, INT, INT, INT, INT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;

COMMENT ON TABLE public.activation_mass_send_jobs IS 'Disparo em massa de ativações (background Netlify)';
