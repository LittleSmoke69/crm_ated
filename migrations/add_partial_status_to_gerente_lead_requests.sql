-- =====================================================
-- Migration: Adiciona status 'partial' em gerente_lead_requests
-- Descrição: status partial = alguns leads enviados mas faltam para completar a solicitação
-- =====================================================

ALTER TABLE gerente_lead_requests
  DROP CONSTRAINT IF EXISTS gerente_lead_requests_status_check;

ALTER TABLE gerente_lead_requests
  ADD CONSTRAINT gerente_lead_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'partial'));

COMMENT ON COLUMN gerente_lead_requests.status IS 'pending=aguardando; approved=100% atendida; rejected=rejeitada; partial=alguns leads enviados, faltam para completar';
