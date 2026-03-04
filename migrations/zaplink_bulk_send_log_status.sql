-- =====================================================
-- Migration: Status do disparo em zaplink_bulk_send_log
-- Data: 2026-03-03
-- Descrição: Adiciona status (sucesso/falha) e mensagem de erro ao log de disparo.
-- =====================================================

ALTER TABLE zaplink_bulk_send_log
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  ADD COLUMN IF NOT EXISTS error_message text NULL;

COMMENT ON COLUMN zaplink_bulk_send_log.status IS 'success = disparo concluído; failed = erro ao enviar';
COMMENT ON COLUMN zaplink_bulk_send_log.error_message IS 'Mensagem de erro quando status = failed';
