-- =====================================================
-- Migration: Snapshots completos por lead na transferência (histórico & conversão)
-- Data: 2026-02-17
-- Descrição: Salva no momento da transferência: total_depositado, total_apostado,
--            total_ganho e saque disponível, além do saldo já existente.
-- =====================================================

ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS total_depositado_snapshot NUMERIC(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_apostado_snapshot NUMERIC(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_ganho_snapshot NUMERIC(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS available_withdraw_snapshot NUMERIC(14,2) DEFAULT NULL;

COMMENT ON COLUMN admin_lead_transfer_entries.total_depositado_snapshot IS 'Total depositado do lead no momento da transferência';
COMMENT ON COLUMN admin_lead_transfer_entries.total_apostado_snapshot IS 'Total apostado do lead no momento da transferência';
COMMENT ON COLUMN admin_lead_transfer_entries.total_ganho_snapshot IS 'Total prêmio (ganho) do lead no momento da transferência';
COMMENT ON COLUMN admin_lead_transfer_entries.available_withdraw_snapshot IS 'Saque disponível do lead no momento da transferência';
