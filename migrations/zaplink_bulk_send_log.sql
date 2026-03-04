-- =====================================================
-- Migration: Log de disparos em massa Zaplink (gerente)
-- Data: 2026-03-03
-- Descrição: Registra cada disparo em massa para novos consultores,
--            visível no contexto Zaplink para o gerente.
-- =====================================================

CREATE TABLE IF NOT EXISTS zaplink_bulk_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerente_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_count int NOT NULL DEFAULT 0,
  message_preview text NOT NULL,
  delay_seconds int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zaplink_bulk_send_log_gerente ON zaplink_bulk_send_log(gerente_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_bulk_send_log_created ON zaplink_bulk_send_log(created_at DESC);

ALTER TABLE zaplink_bulk_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zaplink_bulk_send_log_no_anon" ON zaplink_bulk_send_log FOR ALL USING (false);

COMMENT ON TABLE zaplink_bulk_send_log IS 'Histórico de disparos em massa (Zaplink) por gerente; exibido no modal Zaplink';
