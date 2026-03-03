-- =====================================================
-- Migration: Total sacado (total_saque) no momento da transferência
-- Data: 2026-03-02
-- Descrição: Adiciona total_saque_snapshot em admin_lead_transfer_entries
--            para análise de conversão (comparar antes/depois do saque).
-- =====================================================

ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS total_saque_snapshot NUMERIC(14,2) DEFAULT NULL;

COMMENT ON COLUMN admin_lead_transfer_entries.total_saque_snapshot IS 'Total sacado do lead no momento da transferência';
