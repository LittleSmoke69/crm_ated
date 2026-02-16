-- =====================================================
-- Migration: Snapshots e filtros para métricas de transferência
-- Data: 2026-02-12
-- Descrição: saldo_snapshot e last_interaction_snapshot por lead;
--            filters_snapshot no log; had_balance para métricas com/sem saldo.
-- =====================================================

-- admin_lead_transfer_logs: snapshot dos filtros usados na transferência
ALTER TABLE admin_lead_transfer_logs
  ADD COLUMN IF NOT EXISTS filters_snapshot JSONB DEFAULT NULL;

COMMENT ON COLUMN admin_lead_transfer_logs.filters_snapshot IS 'Snapshot dos filtros usados: inatividade, saldo, tag, search, etc.';

-- admin_lead_transfer_entries: snapshot por lead para conversão/recorrência
ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS saldo_snapshot NUMERIC(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_interaction_snapshot TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS had_balance BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_had_balance
  ON admin_lead_transfer_entries(had_balance) WHERE had_balance = TRUE;

COMMENT ON COLUMN admin_lead_transfer_entries.saldo_snapshot IS 'Saldo do lead no momento exato da transferência';
COMMENT ON COLUMN admin_lead_transfer_entries.last_interaction_snapshot IS 'Última interação do lead no momento da transferência';
COMMENT ON COLUMN admin_lead_transfer_entries.had_balance IS 'True se saldo_snapshot > 0 no momento da transferência';
