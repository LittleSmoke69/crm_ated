-- Relaciona campanhas Meta com consultores (1 campanha -> N consultores).
CREATE TABLE IF NOT EXISTS meta_campaign_consultors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  consultor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, campaign_id, consultor_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_consultors_banca_campaign
  ON meta_campaign_consultors (banca_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_consultors_consultor
  ON meta_campaign_consultors (consultor_id);

COMMENT ON TABLE meta_campaign_consultors IS
  'Atribuicao de consultores para campanhas Meta por banca.';
