-- Consultor que recebe o spend Meta no card "Ads (Meta/Redirect)" em Meu Desempenho.
-- Se NULL, mantém o comportamento anterior (vínculos em meta_campaign_consultors + inferência redirect).

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS ads_attribution_consultor_id uuid REFERENCES profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_ads_attribution_consultor
  ON meta_campaigns (ads_attribution_consultor_id)
  WHERE ads_attribution_consultor_id IS NOT NULL;

COMMENT ON COLUMN meta_campaigns.ads_attribution_consultor_id IS
  'Quando preenchido, só este consultor acumula o spend desta campanha em Meu Desempenho (Meta). NULL = regra automática pelos vínculos.';
