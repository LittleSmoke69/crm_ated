-- =====================================================
-- MODELAGEM 07 — ETIQUETAS DO CRM (crm_tags + crm_lead_tags)
-- Usadas nos cards do Kanban de clientes. Schema compatível com
-- app/api/crm/tags e app/api/crm/leads/tags.
-- Idempotente.
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#E86A24',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (label)
);

ALTER TABLE crm_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_tags_read ON crm_tags;
CREATE POLICY crm_tags_read ON crm_tags FOR SELECT USING (true);
DROP POLICY IF EXISTS crm_tags_admin ON crm_tags;
CREATE POLICY crm_tags_admin ON crm_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin'))
);

CREATE TABLE IF NOT EXISTS crm_lead_tags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_external_id TEXT NOT NULL,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tag_id           UUID NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (lead_external_id, user_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_lead_user ON crm_lead_tags(lead_external_id, user_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_tag ON crm_lead_tags(tag_id);

ALTER TABLE crm_lead_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_lead_tags_owner ON crm_lead_tags;
CREATE POLICY crm_lead_tags_owner ON crm_lead_tags FOR ALL USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin','suporte'))
);

-- Etiquetas padrão
INSERT INTO crm_tags (label, color) VALUES
  ('Quente',    '#ef4444'),
  ('Morno',     '#f59e0b'),
  ('Frio',      '#3b82f6'),
  ('VIP',       '#a855f7'),
  ('Recontato', '#6b7280')
ON CONFLICT (label) DO NOTHING;
