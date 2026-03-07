-- =====================================================
-- Adiciona status 'repassado' ao resolution_status
-- Usado quando leads são movidos para outro consultor (Mover leads)
-- Depende: add_resolution_to_lead_transfer_entries.sql
-- =====================================================

-- PostgreSQL: DROP IF EXISTS não gera erro se não existir
ALTER TABLE admin_lead_transfer_entries
  DROP CONSTRAINT IF EXISTS admin_lead_transfer_entries_resolution_status_check;

ALTER TABLE admin_lead_transfer_entries
  ADD CONSTRAINT admin_lead_transfer_entries_resolution_status_check
  CHECK (resolution_status IN ('pending', 'vinculado', 'disponivel_retransferencia', 'repassado'));

COMMENT ON COLUMN admin_lead_transfer_entries.resolution_status IS 'pending=no prazo; vinculado=lead ficou com consultor (converteu); disponivel_retransferencia=pode mover para próximo; repassado=já foi movido para outro consultor';
