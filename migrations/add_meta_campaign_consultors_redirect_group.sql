-- Grupo WhatsApp registrado manualmente na atribuição consultor ↔ campanha Meta.
ALTER TABLE meta_campaign_consultors
  ADD COLUMN IF NOT EXISTS whatsapp_group_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_group_invite_url TEXT;

-- Remove vínculo antigo com redirect_groups, se existir.
ALTER TABLE meta_campaign_consultors DROP COLUMN IF EXISTS redirect_group_id;

DROP INDEX IF EXISTS idx_meta_campaign_consultors_redirect_group;

COMMENT ON COLUMN meta_campaign_consultors.whatsapp_group_name IS
  'Nome do grupo WhatsApp informado pelo gestor na atribuição da campanha Meta.';
COMMENT ON COLUMN meta_campaign_consultors.whatsapp_group_invite_url IS
  'Link de convite do grupo WhatsApp informado pelo gestor na atribuição da campanha Meta.';
