-- Permite o mesmo consultor em vários grupos WhatsApp na mesma campanha.
ALTER TABLE meta_campaign_consultors
  DROP CONSTRAINT IF EXISTS meta_campaign_consultors_banca_id_campaign_id_consultor_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_campaign_consultors_banca_campaign_consultor_group
  ON meta_campaign_consultors (
    banca_id,
    campaign_id,
    consultor_id,
    COALESCE(whatsapp_group_invite_url, '')
  );

COMMENT ON INDEX idx_meta_campaign_consultors_banca_campaign_consultor_group IS
  'Um consultor pode ter vários grupos na mesma campanha (URLs distintas).';
