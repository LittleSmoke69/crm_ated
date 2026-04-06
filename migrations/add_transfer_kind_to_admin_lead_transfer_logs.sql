-- Classifica o fluxo da transferência (admin normal vs estoque gerente).

ALTER TABLE admin_lead_transfer_logs
  ADD COLUMN IF NOT EXISTS transfer_kind TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE admin_lead_transfer_logs
  DROP CONSTRAINT IF EXISTS admin_lead_transfer_logs_transfer_kind_check;

ALTER TABLE admin_lead_transfer_logs
  ADD CONSTRAINT admin_lead_transfer_logs_transfer_kind_check
  CHECK (transfer_kind IN ('standard', 'admin_to_gerente_stock', 'gerente_stock_to_consultant'));

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_logs_transfer_kind ON admin_lead_transfer_logs(transfer_kind);

COMMENT ON COLUMN admin_lead_transfer_logs.transfer_kind IS
  'standard=fluxo admin; admin_to_gerente_stock=admin enviou para estoque do gerente; gerente_stock_to_consultant=gerente distribuiu para consultor.';
