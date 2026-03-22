-- =====================================================
-- Migration: Zaplink - Remoções de consultor pelo gerente
-- Data: 2026-03-21
-- Descrição: Gerente pode remover consultor da sua rede Zaplink; admin visualiza histórico.
-- =====================================================

CREATE TABLE IF NOT EXISTS zaplink_consultant_removals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerente_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultant_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_id uuid NULL REFERENCES zaplink_consultant_requests(id) ON DELETE SET NULL,
  removed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gerente_id, consultant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_zaplink_removals_gerente ON zaplink_consultant_removals(gerente_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_removals_consultant ON zaplink_consultant_removals(consultant_user_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_removals_removed_at ON zaplink_consultant_removals(removed_at DESC);

ALTER TABLE zaplink_consultant_removals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zaplink_consultant_removals_no_anon" ON zaplink_consultant_removals FOR ALL USING (false);

COMMENT ON TABLE zaplink_consultant_removals IS 'Consultores removidos pelo gerente da rede Zaplink; admin pode visualizar histórico';
