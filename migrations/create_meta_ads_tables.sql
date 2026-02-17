-- =====================================================
-- Migration: Tabelas para integração Meta Ads (Facebook/Instagram)
-- Data: 2026-02-07
-- Descrição: Armazena configuração, campanhas, adsets e insights diários da Meta Graph API
-- =====================================================

-- 1) meta_integrations - configuração por banca
CREATE TABLE IF NOT EXISTS meta_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(banca_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_integrations_banca_id ON meta_integrations(banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_integrations_is_active ON meta_integrations(is_active);

-- 2) meta_campaigns
CREATE TABLE IF NOT EXISTS meta_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  name TEXT,
  objective TEXT,
  status TEXT,
  effective_status TEXT,
  daily_budget NUMERIC,
  lifetime_budget NUMERIC,
  start_time TIMESTAMPTZ,
  stop_time TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(banca_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_banca_id ON meta_campaigns(banca_id);

-- 3) meta_adsets
CREATE TABLE IF NOT EXISTS meta_adsets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
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
  UNIQUE(banca_id, adset_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_banca_id ON meta_adsets(banca_id);

-- 4) meta_insights_daily
CREATE TABLE IF NOT EXISTS meta_insights_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(banca_id, date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_insights_daily_banca_date ON meta_insights_daily(banca_id, date DESC);

-- RLS: meta_integrations - somente admin pode SELECT/INSERT/UPDATE
ALTER TABLE meta_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage meta_integrations"
  ON meta_integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

-- RLS: meta_campaigns, meta_adsets, meta_insights_daily - admin + gestor podem ler
ALTER TABLE meta_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_adsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_insights_daily ENABLE ROW LEVEL SECURITY;

-- Admin/Super Admin: acesso total
CREATE POLICY "Admins can manage meta_campaigns"
  ON meta_campaigns FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Admins can manage meta_adsets"
  ON meta_adsets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Admins can manage meta_insights_daily"
  ON meta_insights_daily FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

-- Gestor: pode ler dados das bancas às quais está atribuído
CREATE POLICY "Gestor can read meta_campaigns for assigned bancas"
  ON meta_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
      AND ub.banca_id = meta_campaigns.banca_id
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Gestor can read meta_adsets for assigned bancas"
  ON meta_adsets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
      AND ub.banca_id = meta_adsets.banca_id
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

CREATE POLICY "Gestor can read meta_insights_daily for assigned bancas"
  ON meta_insights_daily FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
      AND ub.banca_id = meta_insights_daily.banca_id
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

-- Comentários
COMMENT ON TABLE meta_integrations IS 'Configuração da integração Meta Ads por banca; token armazenado criptografado';
COMMENT ON TABLE meta_campaigns IS 'Campanhas Meta Ads sincronizadas por banca';
COMMENT ON TABLE meta_adsets IS 'AdSets Meta Ads sincronizados por banca';
COMMENT ON TABLE meta_insights_daily IS 'Insights diários Meta Ads por campanha e banca';
