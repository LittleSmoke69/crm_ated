-- Múltiplos consultores podem receber atribuição do spend Ads (Meu Desempenho) na mesma campanha.
ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS ads_attribution_consultor_ids uuid[];

COMMENT ON COLUMN meta_campaigns.ads_attribution_consultor_ids IS
  'Lista de perfis (consultor/super_admin) que acumulam o spend Meta desta campanha no card Ads em Meu Desempenho. Se preenchida, estes perfis recebem o crédito (cada um com o valor integral da campanha). ads_attribution_consultor_id permanece como primeiro ID para compatibilidade.';

UPDATE meta_campaigns
SET ads_attribution_consultor_ids = ARRAY[ads_attribution_consultor_id]::uuid[]
WHERE ads_attribution_consultor_id IS NOT NULL
  AND (ads_attribution_consultor_ids IS NULL OR cardinality(ads_attribution_consultor_ids) = 0);
