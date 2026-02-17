-- =====================================================
-- Migration: Corrige FK performed_by_user_id em admin_lead_transfer_logs
-- Data: 2026-02-12
-- Descrição: Referencia profiles(id) em vez de auth.users(id) para evitar
--            erro 23503 quando o usuário existe em profiles mas a FK aponta para auth.users.
-- =====================================================

ALTER TABLE admin_lead_transfer_logs
  DROP CONSTRAINT IF EXISTS admin_lead_transfer_logs_performed_by_user_id_fkey;

ALTER TABLE admin_lead_transfer_logs
  ADD CONSTRAINT admin_lead_transfer_logs_performed_by_user_id_fkey
  FOREIGN KEY (performed_by_user_id) REFERENCES profiles(id) ON DELETE CASCADE;

COMMENT ON COLUMN admin_lead_transfer_logs.performed_by_user_id IS 'ID do usuário admin que realizou a transferência (profiles.id)';
