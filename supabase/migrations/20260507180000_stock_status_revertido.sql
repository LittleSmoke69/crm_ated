-- Permite marcar reserva de estoque como revertida ao consultor doador (sem repasse ao CRM quando ainda em_estoque).

ALTER TABLE admin_lead_transfer_entries
  DROP CONSTRAINT IF EXISTS admin_lead_transfer_entries_stock_status_check;

ALTER TABLE admin_lead_transfer_entries
  ADD CONSTRAINT admin_lead_transfer_entries_stock_status_check
  CHECK (stock_status IS NULL OR stock_status IN ('em_estoque', 'repassado', 'cancelado', 'revertido'));

COMMENT ON COLUMN admin_lead_transfer_entries.stock_status IS
  'Estado da reserva no estoque lógico: em_estoque, repassado, cancelado ou revertido (devolvido ao doador no processo).';
