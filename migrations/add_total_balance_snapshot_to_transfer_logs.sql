-- =====================================================
-- Migration: total_balance_snapshot em admin_lead_transfer_logs
-- Data: 2026-02-15
-- Descrição: Armazena o total saldo (soma dos leads) recalculado pelo botão no modal;
--            a tabela principal exibe este valor na coluna "Total saldo".
-- =====================================================

ALTER TABLE admin_lead_transfer_logs
  ADD COLUMN IF NOT EXISTS total_balance_snapshot NUMERIC(14,2) DEFAULT NULL;

COMMENT ON COLUMN admin_lead_transfer_logs.total_balance_snapshot IS 'Total saldo da transferência (soma dos saldo_snapshot das entries); preenchido pelo Recalcular saldo no modal.';
