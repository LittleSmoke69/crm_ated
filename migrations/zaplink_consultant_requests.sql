-- =====================================================
-- Migration: Solicitações de consultor (Zaplink)
-- Data: 2026-03-03
-- Descrição: Gerente solicita N consultores para uma banca; admin atende total ou parcial;
--            pedido fica em aberto até quantity_sent >= quantity_requested.
-- =====================================================

CREATE TABLE IF NOT EXISTS zaplink_consultant_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gerente_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banca_id uuid NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  quantity_requested int NOT NULL CHECK (quantity_requested > 0),
  quantity_sent int NOT NULL DEFAULT 0 CHECK (quantity_sent >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zaplink_consultant_requests_gerente ON zaplink_consultant_requests(gerente_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_consultant_requests_banca ON zaplink_consultant_requests(banca_id);
CREATE INDEX IF NOT EXISTS idx_zaplink_consultant_requests_created ON zaplink_consultant_requests(created_at DESC);

-- Consultores enviados por solicitação (cada linha = 1 consultor enviado)
CREATE TABLE IF NOT EXISTS zaplink_consultant_request_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES zaplink_consultant_requests(id) ON DELETE CASCADE,
  consultant_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id, consultant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_zaplink_fulfillments_request ON zaplink_consultant_request_fulfillments(request_id);

ALTER TABLE zaplink_consultant_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaplink_consultant_request_fulfillments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zaplink_consultant_requests_no_anon" ON zaplink_consultant_requests FOR ALL USING (false);
CREATE POLICY "zaplink_consultant_request_fulfillments_no_anon" ON zaplink_consultant_request_fulfillments FOR ALL USING (false);

COMMENT ON TABLE zaplink_consultant_requests IS 'Solicitações de consultores feitas pelo gerente; admin atende total ou parcial';
COMMENT ON TABLE zaplink_consultant_request_fulfillments IS 'Consultores enviados por solicitação; cada linha = 1 consultor';
