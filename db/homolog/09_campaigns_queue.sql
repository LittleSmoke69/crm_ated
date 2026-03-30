-- Homolog: fila add-to-group (campanhas / Netlify process-campaign-queue)

CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  group_subject TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_contacts INTEGER NOT NULL DEFAULT 0,
  processed_contacts INTEGER NOT NULL DEFAULT 0,
  failed_contacts INTEGER NOT NULL DEFAULT 0,
  strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
  instances TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  custom_list_id UUID,
  observation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON public.campaigns (user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns (status);

CREATE TABLE IF NOT EXISTS public.campaign_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  group_subject TEXT,
  target_contacts INTEGER NOT NULL DEFAULT 0,
  processed_contacts INTEGER NOT NULL DEFAULT 0,
  failed_contacts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_groups_campaign_id ON public.campaign_groups (campaign_id);

CREATE TABLE IF NOT EXISTS public.campaign_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  campaign_group_id UUID NOT NULL REFERENCES public.campaign_groups (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  contact_id UUID,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  instance_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_contacts_due
  ON public.campaign_contacts (campaign_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_position
  ON public.campaign_contacts (campaign_id, position);

ALTER TABLE public.campaign_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_due_campaign_contacts(
  worker_id TEXT,
  batch_limit INTEGER DEFAULT 20,
  lock_ttl_minutes INTEGER DEFAULT 3
)
RETURNS SETOF public.campaign_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_expiry TIMESTAMPTZ;
BEGIN
  lock_expiry := NOW() - (lock_ttl_minutes || ' minutes')::INTERVAL;

  RETURN QUERY
  UPDATE public.campaign_contacts cc
  SET
    status = 'processing',
    locked_at = NOW(),
    locked_by = worker_id,
    attempts = cc.attempts + 1,
    started_at = COALESCE(cc.started_at, NOW()),
    updated_at = NOW()
  WHERE cc.id IN (
    SELECT c.id
    FROM public.campaign_contacts c
    WHERE c.status IN ('queued', 'retry')
      AND c.scheduled_at <= NOW()
      AND (c.locked_at IS NULL OR c.locked_at < lock_expiry)
    ORDER BY c.scheduled_at ASC, c.position ASC
    LIMIT batch_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING cc.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalizar_campaign_se_necessario(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pendentes INTEGER;
BEGIN
  SELECT COUNT(*) INTO pendentes
  FROM public.campaign_contacts
  WHERE campaign_id = p_campaign_id
    AND status IN ('queued', 'processing', 'retry');

  IF pendentes > 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.campaigns
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
  WHERE id = p_campaign_id
    AND status = 'running';

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_due_campaign_contacts(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_campaign_contacts(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_campaign_contacts(TEXT, INTEGER, INTEGER) TO anon;

GRANT EXECUTE ON FUNCTION public.finalizar_campaign_se_necessario(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalizar_campaign_se_necessario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_campaign_se_necessario(UUID) TO anon;
