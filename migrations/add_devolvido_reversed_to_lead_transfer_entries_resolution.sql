-- =====================================================
-- Adiciona status 'devolvido' e 'reversed' ao resolution_status
-- devolvido: leads devolvidos ao consultor de origem (entries da transferência original)
-- reversed: entries de devolução que foram revertidas (reverse)
-- Depende: add_repassado_to_lead_transfer_entries_resolution.sql
-- =====================================================

ALTER TABLE admin_lead_transfer_entries
  DROP CONSTRAINT IF EXISTS admin_lead_transfer_entries_resolution_status_check;

ALTER TABLE admin_lead_transfer_entries
  ADD CONSTRAINT admin_lead_transfer_entries_resolution_status_check
  CHECK (resolution_status IN ('pending', 'vinculado', 'disponivel_retransferencia', 'repassado', 'devolvido', 'reversed'));

COMMENT ON COLUMN admin_lead_transfer_entries.resolution_status IS 'pending=no prazo; vinculado=lead ficou com consultor (converteu); disponivel_retransferencia=pode mover para próximo; repassado=já foi movido para outro consultor; devolvido=leads devolvidos ao origem; reversed=devolução revertida';
