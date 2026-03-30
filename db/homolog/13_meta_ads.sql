-- Homolog: Meta Ads (integração por banca + modelo compartilhado + consultores).
-- Depende: crm_bancas (02), profiles (02), user_bancas com banca_ids JSONB (05).
-- RLS de gestor usa user_bancas.banca_ids @> jsonb_build_array(banca_id::text) (não banca_id).

-- ---------------------------------------------------------------------------
-- 1) meta_integrations (legado por banca; app ainda pode usar)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES public.crm_bancas (id) ON DELETE CASCADE,
  base_url TEXT NOT NULL DEFAULT 'https://graph.facebook.com/v19.0',
  access_token_encrypted TEXT,
  token_last4 TEXT,
  ad_account_id TEXT,
  pixel_id TEXT,
  default_campaign_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  last_sync_date_preset TEXT,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_integrations_banca_id ON public.meta_integrations (banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_integrations_is_active ON public.meta_integrations (is_active);

-- ---------------------------------------------------------------------------
-- 2) meta_campaigns, meta_adsets, meta_insights_daily
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES public.crm_bancas (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  name TEXT,
  objective TEXT,
  status TEXT,
  effective_status TEXT,
  daily_budget NUMERIC,
  lifetime_budget NUMERIC,
  start_time TIMESTAMPTZ,
  stop_time TIMESTAMPTZ,
  campaign_kind TEXT NOT NULL DEFAULT 'normal',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, campaign_id)
);

ALTER TABLE public.meta_campaigns DROP CONSTRAINT IF EXISTS meta_campaigns_campaign_kind_check;
ALTER TABLE public.meta_campaigns ADD CONSTRAINT meta_campaigns_campaign_kind_check
  CHECK (campaign_kind IN ('normal', 'bolao'));

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_banca_id ON public.meta_campaigns (banca_id);

CREATE TABLE IF NOT EXISTS public.meta_adsets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES public.crm_bancas (id) ON DELETE CASCADE,
  adset_id TEXT NOT NULL,
  campaign_id TEXT,
  name TEXT,
  status TEXT,
  effective_status TEXT,
  daily_budget NUMERIC,
  lifetime_budget NUMERIC,
  billing_event TEXT,
  optimization_goal TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, adset_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_banca_id ON public.meta_adsets (banca_id);

CREATE TABLE IF NOT EXISTS public.meta_insights_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES public.crm_bancas (id) ON DELETE CASCADE,
  date DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  reach BIGINT DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  spend NUMERIC DEFAULT 0,
  cpm NUMERIC,
  cpc NUMERIC,
  ctr NUMERIC,
  leads BIGINT DEFAULT 0,
  raw_actions JSONB,
  raw_cost_per_action_type JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_insights_daily_banca_date ON public.meta_insights_daily (banca_id, date DESC);

-- ---------------------------------------------------------------------------
-- 3) Integração compartilhada (1 config -> N bancas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_integration_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_url TEXT NOT NULL DEFAULT 'https://graph.facebook.com/v19.0',
  access_token_encrypted TEXT,
  token_last4 TEXT,
  ad_account_id TEXT,
  pixel_id TEXT,
  default_campaign_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  currency TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  last_sync_date_preset TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_integration_configs_is_active ON public.meta_integration_configs (is_active);

CREATE TABLE IF NOT EXISTS public.meta_integration_bancas (
  integration_id UUID NOT NULL REFERENCES public.meta_integration_configs (id) ON DELETE CASCADE,
  banca_id UUID NOT NULL REFERENCES public.crm_bancas (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (integration_id, banca_id),
  UNIQUE (banca_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_integration_bancas_banca_id ON public.meta_integration_bancas (banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_integration_bancas_integration_id ON public.meta_integration_bancas (integration_id);

-- Migração leve: se já existir meta_integrations com linhas sem vínculo, preenche configs (homolog vazio = no-op).
WITH inserted AS (
  INSERT INTO public.meta_integration_configs (
    base_url,
    access_token_encrypted,
    token_last4,
    ad_account_id,
    pixel_id,
    default_campaign_id,
    is_active,
    currency,
    last_sync_at,
    last_sync_error,
    last_sync_date_preset,
    created_at,
    updated_at
  )
  SELECT
    mi.base_url,
    mi.access_token_encrypted,
    mi.token_last4,
    mi.ad_account_id,
    mi.pixel_id,
    mi.default_campaign_id,
    mi.is_active,
    mi.currency,
    mi.last_sync_at,
    mi.last_sync_error,
    mi.last_sync_date_preset,
    mi.created_at,
    mi.updated_at
  FROM public.meta_integrations mi
  WHERE NOT EXISTS (
    SELECT 1 FROM public.meta_integration_bancas mib WHERE mib.banca_id = mi.banca_id
  )
  RETURNING id
),
to_link AS (
  SELECT
    mi.banca_id,
    mic.id AS integration_id
  FROM public.meta_integrations mi
  JOIN LATERAL (
    SELECT id
    FROM public.meta_integration_configs
    WHERE base_url = mi.base_url
      AND token_last4 IS NOT DISTINCT FROM mi.token_last4
      AND ad_account_id IS NOT DISTINCT FROM mi.ad_account_id
      AND pixel_id IS NOT DISTINCT FROM mi.pixel_id
      AND default_campaign_id IS NOT DISTINCT FROM mi.default_campaign_id
      AND is_active = mi.is_active
    ORDER BY created_at DESC
    LIMIT 1
  ) mic ON TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.meta_integration_bancas mib WHERE mib.banca_id = mi.banca_id
  )
)
INSERT INTO public.meta_integration_bancas (integration_id, banca_id)
SELECT integration_id, banca_id FROM to_link
ON CONFLICT (banca_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Consultores por campanha
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_campaign_consultors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES public.crm_bancas (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  consultor_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, campaign_id, consultor_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_consultors_banca_campaign
  ON public.meta_campaign_consultors (banca_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaign_consultors_consultor
  ON public.meta_campaign_consultors (consultor_id);

-- ---------------------------------------------------------------------------
-- 5) RLS (gestor via banca_ids JSONB)
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_adsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_insights_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_integration_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_integration_bancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_campaign_consultors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage meta_integrations" ON public.meta_integrations;
CREATE POLICY "Admins can manage meta_integrations"
  ON public.meta_integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage meta_campaigns" ON public.meta_campaigns;
CREATE POLICY "Admins can manage meta_campaigns"
  ON public.meta_campaigns FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Gestor can read meta_campaigns for assigned bancas" ON public.meta_campaigns;
CREATE POLICY "Gestor can read meta_campaigns for assigned bancas"
  ON public.meta_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.user_bancas ub ON ub.user_id = p.id AND ub.banca_ids @> jsonb_build_array (meta_campaigns.banca_id::text)
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage meta_adsets" ON public.meta_adsets;
CREATE POLICY "Admins can manage meta_adsets"
  ON public.meta_adsets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Gestor can read meta_adsets for assigned bancas" ON public.meta_adsets;
CREATE POLICY "Gestor can read meta_adsets for assigned bancas"
  ON public.meta_adsets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.user_bancas ub ON ub.user_id = p.id AND ub.banca_ids @> jsonb_build_array (meta_adsets.banca_id::text)
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage meta_insights_daily" ON public.meta_insights_daily;
CREATE POLICY "Admins can manage meta_insights_daily"
  ON public.meta_insights_daily FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Gestor can read meta_insights_daily for assigned bancas" ON public.meta_insights_daily;
CREATE POLICY "Gestor can read meta_insights_daily for assigned bancas"
  ON public.meta_insights_daily FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.user_bancas ub ON ub.user_id = p.id AND ub.banca_ids @> jsonb_build_array (meta_insights_daily.banca_id::text)
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage meta_integration_configs" ON public.meta_integration_configs;
CREATE POLICY "Admins can manage meta_integration_configs"
  ON public.meta_integration_configs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage meta_integration_bancas" ON public.meta_integration_bancas;
CREATE POLICY "Admins can manage meta_integration_bancas"
  ON public.meta_integration_bancas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage meta_campaign_consultors" ON public.meta_campaign_consultors;
CREATE POLICY "Admins can manage meta_campaign_consultors"
  ON public.meta_campaign_consultors FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Gestor can read meta_campaign_consultors for assigned bancas" ON public.meta_campaign_consultors;
CREATE POLICY "Gestor can read meta_campaign_consultors for assigned bancas"
  ON public.meta_campaign_consultors FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.user_bancas ub ON ub.user_id = p.id AND ub.banca_ids @> jsonb_build_array (meta_campaign_consultors.banca_id::text)
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

COMMENT ON TABLE public.meta_integrations IS 'Configuração Meta Ads por banca (legado); token criptografado';
COMMENT ON TABLE public.meta_campaigns IS 'Campanhas Meta Ads sincronizadas por banca';
COMMENT ON TABLE public.meta_adsets IS 'AdSets Meta Ads sincronizados por banca';
COMMENT ON TABLE public.meta_insights_daily IS 'Insights diários Meta Ads por campanha e banca';
COMMENT ON TABLE public.meta_integration_configs IS 'Configuração Meta Ads compartilhada (várias bancas)';
COMMENT ON TABLE public.meta_integration_bancas IS 'Vínculo banca ↔ integração Meta compartilhada';
COMMENT ON TABLE public.meta_campaign_consultors IS 'Atribuição de consultores a campanhas Meta por banca';
COMMENT ON COLUMN public.meta_campaigns.campaign_kind IS 'normal | bolao — definido no admin';
COMMENT ON COLUMN public.meta_insights_daily.raw_cost_per_action_type IS 'Snapshot cost_per_action_type da Graph API';
