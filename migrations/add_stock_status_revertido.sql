-- Espelho de supabase/migrations/20260507180000_stock_status_revertido.sql

ALTER TABLE admin_lead_transfer_entries
  DROP CONSTRAINT IF EXISTS admin_lead_transfer_entries_stock_status_check;

ALTER TABLE admin_lead_transfer_entries
  ADD CONSTRAINT admin_lead_transfer_entries_stock_status_check
  CHECK (stock_status IS NULL OR stock_status IN ('em_estoque', 'repassado', 'cancelado', 'revertido'));
