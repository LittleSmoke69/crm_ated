-- =====================================================
-- Migration: Tabela gerente_lead_requests (solicitações de leads do gerente para o admin)
-- Data: 2026-03-02
-- Descrição: Gerente solicita leads; admin aprova na aba Solicitações do lead-transfer e escolhe consultor doador
-- =====================================================

CREATE TABLE IF NOT EXISTS gerente_lead_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gerente_id UUID NOT NULL,
  gerente_name TEXT NOT NULL,
  lead_type TEXT NOT NULL CHECK (lead_type IN ('registered', 'with_balance', 'has_won', 'has_withdrawn')),
  consultores JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  banca_id UUID NULL,
  source_consultant_id UUID NULL,
  source_consultant_email TEXT NULL,
  approved_by_user_id UUID NULL,
  approved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gerente_lead_requests_gerente_id ON gerente_lead_requests(gerente_id);
CREATE INDEX IF NOT EXISTS idx_gerente_lead_requests_status ON gerente_lead_requests(status);
CREATE INDEX IF NOT EXISTS idx_gerente_lead_requests_created_at ON gerente_lead_requests(created_at DESC);

ALTER TABLE gerente_lead_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read and update gerente_lead_requests"
  ON gerente_lead_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

-- Gerente pode apenas inserir e ver suas próprias solicitações
CREATE POLICY "Gerente can insert own gerente_lead_requests"
  ON gerente_lead_requests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status = 'gerente'
      AND profiles.id = gerente_id
    )
  );

CREATE POLICY "Gerente can select own gerente_lead_requests"
  ON gerente_lead_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status = 'gerente'
      AND profiles.id = gerente_id
    )
  );

COMMENT ON TABLE gerente_lead_requests IS 'Solicitações de leads feitas pelo gerente; admin aprova em admin/crm/lead-transfer e define consultor doador';
COMMENT ON COLUMN gerente_lead_requests.consultores IS 'Array de { consultor_id, quantity } - consultores recebedores e quantidade por um';
COMMENT ON COLUMN gerente_lead_requests.source_consultant_id IS 'Consultor doador (origem dos leads), definido pelo admin ao aprovar';
