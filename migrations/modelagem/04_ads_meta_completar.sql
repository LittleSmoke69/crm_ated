-- =====================================================
-- MODELAGEM 04 — ADS (META) — COMPLETAR O QUE FALTA
-- Objetivo: fechar a hierarquia Meta (campanha → adset → ANÚNCIO), insights por
--           anúncio, atribuição lead→anúncio (Click-to-WhatsApp) e ROI por campanha.
-- Contexto já existente (não recriado): meta_integrations, meta_campaigns,
--   meta_adsets, meta_insights_daily, meta_campaign_consultors.
-- Idempotente. NÃO recria o banco.
-- =====================================================

-- 1) NÍVEL ANÚNCIO (faltava) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_ads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id         UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  ad_id            TEXT NOT NULL,
  adset_id         TEXT,
  campaign_id      TEXT,
  name             TEXT,
  status           TEXT,
  effective_status TEXT,
  creative_id      TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (banca_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_banca ON meta_ads(banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_adset ON meta_ads(banca_id, adset_id);

COMMENT ON TABLE meta_ads IS 'Anúncios individuais Meta sincronizados por banca (nível abaixo de adset).';

-- 2) INSIGHTS DIÁRIOS POR ANÚNCIO ----------------------------------------------
CREATE TABLE IF NOT EXISTS meta_insights_ad_daily (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id     UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  ad_id        TEXT NOT NULL,
  adset_id     TEXT,
  campaign_id  TEXT,
  ad_name      TEXT,
  reach        BIGINT DEFAULT 0,
  impressions  BIGINT DEFAULT 0,
  clicks       BIGINT DEFAULT 0,
  spend        NUMERIC DEFAULT 0,
  cpm          NUMERIC,
  cpc          NUMERIC,
  ctr          NUMERIC,
  leads        BIGINT DEFAULT 0,
  raw_actions  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (banca_id, date, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_insights_ad_daily_banca_date
  ON meta_insights_ad_daily(banca_id, date DESC);

COMMENT ON TABLE meta_insights_ad_daily IS 'Insights diários Meta no nível de anúncio.';

-- 3) ATRIBUIÇÃO LEAD → ANÚNCIO (Click-to-WhatsApp / UTM) -----------------------
--    Liga o lead do CRM ao anúncio que o gerou, para CPL e ROI reais.
--    Lead identificado como no resto do CRM: (lead_external_id, user_id).
CREATE TABLE IF NOT EXISTS crm_lead_ad_attribution (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_external_id TEXT NOT NULL,
  user_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  banca_id         UUID REFERENCES crm_bancas(id) ON DELETE SET NULL,
  campaign_id      TEXT,
  adset_id         TEXT,
  ad_id            TEXT,
  ctwa_clid        TEXT,          -- Click-to-WhatsApp click id (referral do webhook oficial)
  utm_source       TEXT,
  utm_medium       TEXT,
  utm_campaign     TEXT,
  utm_content      TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_external_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_ad_attribution_campaign
  ON crm_lead_ad_attribution(campaign_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_ad_attribution_ad
  ON crm_lead_ad_attribution(ad_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_ad_attribution_ctwa
  ON crm_lead_ad_attribution(ctwa_clid) WHERE ctwa_clid IS NOT NULL;

COMMENT ON TABLE crm_lead_ad_attribution IS 'Atribuição do lead ao anúncio Meta de origem (CTWA/UTM) para CPL e ROI.';

-- 4) VIEW ROI POR CAMPANHA/DIA -------------------------------------------------
--    Cruza gasto (meta_insights_daily) com leads atribuídos e depósito gerado.
CREATE OR REPLACE VIEW meta_campaign_roi_daily AS
WITH gasto AS (
  SELECT banca_id, date, campaign_id, campaign_name,
         sum(spend) AS spend, sum(impressions) AS impressions,
         sum(clicks) AS clicks, sum(leads) AS leads_meta
  FROM meta_insights_daily
  GROUP BY banca_id, date, campaign_id, campaign_name
),
conv AS (
  SELECT a.banca_id, a.campaign_id,
         date_trunc('day', a.first_seen_at)::date AS date,
         count(DISTINCT (a.lead_external_id, a.user_id))    AS leads_crm,
         count(DISTINCT (a.lead_external_id, a.user_id))
           FILTER (WHERE l.total_depositos_count > 0)       AS leads_depositantes,
         coalesce(sum(l.total_depositado), 0)               AS deposito_total
  FROM crm_lead_ad_attribution a
  LEFT JOIN crm_leads l
    ON l.external_id::text = a.lead_external_id
   AND (a.user_id IS NULL OR l.user_id = a.user_id)
  GROUP BY a.banca_id, a.campaign_id, date_trunc('day', a.first_seen_at)
)
SELECT
  g.banca_id,
  g.date,
  g.campaign_id,
  g.campaign_name,
  g.spend,
  g.impressions,
  g.clicks,
  g.leads_meta,
  coalesce(c.leads_crm, 0)          AS leads_crm,
  coalesce(c.leads_depositantes, 0) AS leads_depositantes,
  coalesce(c.deposito_total, 0)     AS deposito_total,
  CASE WHEN coalesce(c.leads_crm, 0) > 0
       THEN g.spend / c.leads_crm END                       AS cpl,          -- custo por lead
  CASE WHEN g.spend > 0
       THEN coalesce(c.deposito_total, 0) / g.spend END      AS roas          -- retorno s/ investimento
FROM gasto g
LEFT JOIN conv c
  ON c.banca_id = g.banca_id AND c.campaign_id = g.campaign_id AND c.date = g.date;

COMMENT ON VIEW meta_campaign_roi_daily IS
  'ROI diário por campanha: gasto Meta x leads atribuídos x depósito gerado (CPL, ROAS).';

-- 5) RLS (espelha o padrão das tabelas meta_*; ADS agora é admin) --------------
ALTER TABLE meta_ads                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_insights_ad_daily   ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_ad_attribution  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_ads_admin ON meta_ads;
CREATE POLICY meta_ads_admin ON meta_ads
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
            AND p.status IN ('super_admin','admin'))
  );

DROP POLICY IF EXISTS meta_insights_ad_daily_admin ON meta_insights_ad_daily;
CREATE POLICY meta_insights_ad_daily_admin ON meta_insights_ad_daily
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
            AND p.status IN ('super_admin','admin'))
  );

-- Atribuição: admin gerencia; consultor lê a de seus próprios leads.
DROP POLICY IF EXISTS crm_lead_ad_attribution_admin ON crm_lead_ad_attribution;
CREATE POLICY crm_lead_ad_attribution_admin ON crm_lead_ad_attribution
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
            AND p.status IN ('super_admin','admin'))
  );

DROP POLICY IF EXISTS crm_lead_ad_attribution_owner_read ON crm_lead_ad_attribution;
CREATE POLICY crm_lead_ad_attribution_owner_read ON crm_lead_ad_attribution
  FOR SELECT USING (user_id = auth.uid());
