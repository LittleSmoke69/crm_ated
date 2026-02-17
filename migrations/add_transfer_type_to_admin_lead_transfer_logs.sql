-- =====================================================
-- Migration: Adiciona transfer_type em admin_lead_transfer_logs
-- Data: 2026-02-12
-- Descrição: Tipo da transferência (TF, TF1, TF2, TF3) para gestão e relatórios
-- =====================================================

ALTER TABLE admin_lead_transfer_logs
  ADD COLUMN IF NOT EXISTS transfer_type TEXT NOT NULL DEFAULT 'TF'
    CHECK (transfer_type IN ('TF', 'TF1', 'TF2', 'TF3'));

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_logs_transfer_type
  ON admin_lead_transfer_logs(transfer_type);

COMMENT ON COLUMN admin_lead_transfer_logs.transfer_type IS 'Tipo da transferência: TF, TF1, TF2, TF3';
