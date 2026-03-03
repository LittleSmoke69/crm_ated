-- =====================================================
-- Migration: lead_type passa a aceitar múltiplos tipos (valores separados por vírgula)
-- Data: 2026-03-02
-- =====================================================

-- Remove o CHECK que restringe a um único valor
ALTER TABLE gerente_lead_requests
  DROP CONSTRAINT IF EXISTS gerente_lead_requests_lead_type_check;

-- lead_type passa a armazenar valores separados por vírgula, ex: 'registered,with_balance,has_won'
COMMENT ON COLUMN gerente_lead_requests.lead_type IS 'Tipos de lead separados por vírgula: registered, with_balance, has_won, has_withdrawn';
