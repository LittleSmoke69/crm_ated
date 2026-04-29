-- Vincula uma campanha Meta a um projeto/redirect VSL para atribuir spend ao redirect.
ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS redirect_project_id UUID NULL REFERENCES vsl_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_redirect_project
  ON meta_campaigns (redirect_project_id);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_banca_redirect_project
  ON meta_campaigns (banca_id, redirect_project_id);

COMMENT ON COLUMN meta_campaigns.redirect_project_id IS
  'Projeto/redirect VSL atribuido manualmente no painel Meta Ads para cruzar spend + billing + consultor.';
