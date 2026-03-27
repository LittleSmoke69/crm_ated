-- Classificação local de campanha Meta: normal vs bolão (não vem da API da Meta).
ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS campaign_kind TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE meta_campaigns
  DROP CONSTRAINT IF EXISTS meta_campaigns_campaign_kind_check;

ALTER TABLE meta_campaigns
  ADD CONSTRAINT meta_campaigns_campaign_kind_check
  CHECK (campaign_kind IN ('normal', 'bolao'));

COMMENT ON COLUMN meta_campaigns.campaign_kind IS 'normal | bolao — definido no admin para relatórios e filtros.';
