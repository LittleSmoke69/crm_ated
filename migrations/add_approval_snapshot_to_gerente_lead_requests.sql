-- =====================================================
-- Migration: Snapshot completo da aprovação para análise posterior
-- Data: 2026-03-02
-- =====================================================

ALTER TABLE gerente_lead_requests
  ADD COLUMN IF NOT EXISTS approval_snapshot JSONB NULL;

COMMENT ON COLUMN gerente_lead_requests.approval_snapshot IS 'Snapshot completo no momento da aprovação/transferência: lead_types, source, receivers com quantity e transfer_log_id, total_leads_transferred, transfer_log_ids, approved_at_iso, para análise posterior';
