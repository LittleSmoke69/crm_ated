-- Gasto diário estimado configurado pelo gestor por consultor/campanha.
ALTER TABLE meta_campaign_consultors
  ADD COLUMN IF NOT EXISTS daily_spend_estimate NUMERIC(12, 2);

COMMENT ON COLUMN meta_campaign_consultors.daily_spend_estimate IS
  'Gasto diário estimado em BRL informado pelo gestor na atribuição consultor ↔ campanha Meta.';
