-- =====================================================
-- Migration: Tabela admin_lead_transfer_entries (um registro por lead transferido)
-- Data: 2026-02-12
-- Descrição: Facilita consultas por consultor origem/destino; cada lead transferido
--            tem uma linha com source_consultant_email e target_consultant_email.
-- =====================================================

CREATE TABLE IF NOT EXISTS admin_lead_transfer_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_log_id UUID NOT NULL REFERENCES admin_lead_transfer_logs(id) ON DELETE CASCADE,
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL,
  source_consultant_email TEXT NOT NULL,
  target_consultant_email TEXT NOT NULL,
  transfer_type TEXT NOT NULL DEFAULT 'TF' CHECK (transfer_type IN ('TF', 'TF1', 'TF2', 'TF3')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_transfer_log_id
  ON admin_lead_transfer_entries(transfer_log_id);
CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_banca_id
  ON admin_lead_transfer_entries(banca_id);
CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_lead_id
  ON admin_lead_transfer_entries(lead_id);
CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_source_email
  ON admin_lead_transfer_entries(source_consultant_email);
CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_target_email
  ON admin_lead_transfer_entries(target_consultant_email);
CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_created_at
  ON admin_lead_transfer_entries(created_at DESC);

ALTER TABLE admin_lead_transfer_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and auditoria can read admin_lead_transfer_entries"
  ON admin_lead_transfer_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin', 'auditoria')
    )
  );

COMMENT ON TABLE admin_lead_transfer_entries IS 'Um registro por lead em cada transferência; consultor de origem e destino por lead';
COMMENT ON COLUMN admin_lead_transfer_entries.lead_id IS 'ID do lead no CRM (pode ser numérico ou string)';
COMMENT ON COLUMN admin_lead_transfer_entries.source_consultant_email IS 'Consultor de quem o lead foi tirado';
COMMENT ON COLUMN admin_lead_transfer_entries.target_consultant_email IS 'Consultor para quem o lead foi enviado';
