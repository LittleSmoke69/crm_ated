-- Vincula opcionalmente um consultor (profile) ao grupo de redirect WhatsApp.
ALTER TABLE redirect_groups
  ADD COLUMN IF NOT EXISTS consultant_user_id uuid NULL REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_redirect_groups_consultant ON redirect_groups(consultant_user_id);

COMMENT ON COLUMN redirect_groups.consultant_user_id IS 'Consultor responsável pelo link do grupo (referência a profiles.id); opcional.';
