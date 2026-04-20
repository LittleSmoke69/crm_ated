-- =====================================================
-- Migration: Reserva lógica de estoque do gerente (sem movimento no CRM).
-- Contexto: admin/super-admin reserva leads ao estoque de um gerente em uma banca.
--           Os leads permanecem com o consultor de origem real no CRM até
--           o gerente distribuir a um consultor da sua equipe.
-- =====================================================

ALTER TABLE admin_lead_transfer_entries
  ADD COLUMN IF NOT EXISTS original_source_consultant_email TEXT,
  ADD COLUMN IF NOT EXISTS stock_status TEXT,
  ADD COLUMN IF NOT EXISTS stock_gerente_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_resolved_at TIMESTAMPTZ;

ALTER TABLE admin_lead_transfer_entries
  DROP CONSTRAINT IF EXISTS admin_lead_transfer_entries_stock_status_check;

ALTER TABLE admin_lead_transfer_entries
  ADD CONSTRAINT admin_lead_transfer_entries_stock_status_check
  CHECK (stock_status IS NULL OR stock_status IN ('em_estoque', 'repassado', 'cancelado'));

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_stock_lookup
  ON admin_lead_transfer_entries(stock_gerente_user_id, banca_id, stock_status);

CREATE INDEX IF NOT EXISTS idx_admin_lead_transfer_entries_original_source
  ON admin_lead_transfer_entries(original_source_consultant_email);

COMMENT ON COLUMN admin_lead_transfer_entries.original_source_consultant_email IS
  'Consultor dono do lead no CRM no momento da reserva ao estoque. Usado no repasse gerente→consultor para chamar o CRM com a origem correta.';
COMMENT ON COLUMN admin_lead_transfer_entries.stock_status IS
  'Estado da reserva no estoque lógico do gerente: em_estoque, repassado ou cancelado. NULL em entries fora do fluxo de estoque.';
COMMENT ON COLUMN admin_lead_transfer_entries.stock_gerente_user_id IS
  'Gerente dono do estoque (profiles.id). Preenchido quando a entry pertence a um pacote admin→estoque.';
COMMENT ON COLUMN admin_lead_transfer_entries.stock_resolved_at IS
  'Momento em que a reserva saiu do estado em_estoque (repasse ou cancelamento).';
