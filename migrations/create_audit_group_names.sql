-- =====================================================
-- Migration: Nomes dos grupos para auditoria (findGroupInfos)
-- Data: 2026-01-30
-- Descrição: Armazena group_subject (nome do grupo) por group_id para exibir na auditoria.
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_group_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  group_subject TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  UNIQUE(group_id, instance_name)
);

COMMENT ON TABLE audit_group_names IS 'Nomes dos grupos (subject) obtidos via Evolution findGroupInfos para auditoria';
COMMENT ON COLUMN audit_group_names.group_id IS 'JID do grupo (ex: 120363390518229500@g.us)';
COMMENT ON COLUMN audit_group_names.instance_name IS 'Nome da instância Evolution';
COMMENT ON COLUMN audit_group_names.group_subject IS 'Nome do grupo retornado pela API';

CREATE INDEX IF NOT EXISTS idx_audit_group_names_group_id ON audit_group_names(group_id);
CREATE INDEX IF NOT EXISTS idx_audit_group_names_instance ON audit_group_names(instance_name);

ALTER TABLE audit_group_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auditoria e admin podem ler audit_group_names"
  ON audit_group_names
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('admin', 'dono_banca', 'gerente', 'auditoria')
    )
  );
