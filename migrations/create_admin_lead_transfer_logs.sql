-- =====================================================
-- Migration: Tabela admin_lead_transfer_logs (auditoria de redistribuição de leads)
-- Data: 2026-02-10
-- Descrição: Registra transferências de leads feitas pelo Admin/Super Admin via CRM API
-- =====================================================

CREATE TABLE IF NOT EXISTS admin_lead_transfer_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  performed_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_consultant_email TEXT NOT NULL,
  target_consultant_email TEXT NOT NULL,
  leads_ids JSONB NOT NULL DEFAULT '[]',
  count INTEGER NOT NULL DEFAULT 0,
  crm_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_logs_banca_id ON admin_lead_transfer_logs(banca_id);
CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_logs_performed_by ON admin_lead_transfer_logs(performed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_logs_created_at ON admin_lead_transfer_logs(created_at DESC);

ALTER TABLE admin_lead_transfer_logs ENABLE ROW LEVEL SECURITY;

-- Apenas leitura para admin/auditoria; escrita via service role (backend)
CREATE POLICY "Admin and auditoria can read admin_lead_transfer_logs"
  ON admin_lead_transfer_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin', 'auditoria')
    )
  );

COMMENT ON TABLE admin_lead_transfer_logs IS 'Auditoria de transferência de leads (redistribuição) feita pelo Admin via CRM API';
COMMENT ON COLUMN admin_lead_transfer_logs.leads_ids IS 'Array de IDs dos leads transferidos';
COMMENT ON COLUMN admin_lead_transfer_logs.crm_response IS 'Resposta bruta do CRM (success, message, etc.)';
