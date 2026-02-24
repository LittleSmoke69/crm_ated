-- =====================================================
-- Resolução pós-prazo da transferência de leads
-- Após 10 dias: vincular (lead ficou com consultor) ou disponível para repasse
-- Depende: create_admin_lead_transfer_entries.sql, add_lead_transfer_entry_snapshot_fields.sql
-- =====================================================

-- Status da resolução por lead (entry)
-- pending: ainda no prazo ou não resolvido
-- vinculado: consultor teve resultado (depósito/aposta); lead fica na carteira
-- disponivel_retransferencia: sem resultado no prazo; pode ser movido para próximo consultor
ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN ('pending', 'vinculado', 'disponivel_retransferencia'));
ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS current_total_depositado_at_resolution NUMERIC(14,2);
ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS current_total_apostado_at_resolution NUMERIC(14,2);

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_resolution
  ON admin_lead_transfer_entries(transfer_log_id, resolution_status) WHERE resolution_status != 'pending';

COMMENT ON COLUMN admin_lead_transfer_entries.resolution_status IS 'pending=no prazo; vinculado=lead ficou com consultor (converteu); disponivel_retransferencia=pode mover para próximo';
COMMENT ON COLUMN admin_lead_transfer_entries.resolved_at IS 'Data/hora em que a resolução foi calculada (após prazo de 10d)';
COMMENT ON COLUMN admin_lead_transfer_entries.current_total_depositado_at_resolution IS 'Total depositado do lead no momento da resolução (CRM)';
COMMENT ON COLUMN admin_lead_transfer_entries.current_total_apostado_at_resolution IS 'Total apostado do lead no momento da resolução (CRM)';
