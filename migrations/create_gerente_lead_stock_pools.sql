-- Estoque de leads por gerente e banca: e-mail CRM que concentra os leads enviados pelo admin.
-- O gerente redistribui desse e-mail para os consultores da sua equipe.

CREATE TABLE IF NOT EXISTS gerente_lead_stock_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gerente_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  pool_consultant_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(gerente_user_id, banca_id)
);

CREATE INDEX IF NOT EXISTS idx_gerente_lead_stock_pools_banca_id ON gerente_lead_stock_pools(banca_id);
CREATE INDEX IF NOT EXISTS idx_gerente_lead_stock_pools_gerente ON gerente_lead_stock_pools(gerente_user_id);

COMMENT ON TABLE gerente_lead_stock_pools IS 'E-mail consultor CRM usado como estoque de leads do gerente por banca; admin envia leads para este e-mail.';
COMMENT ON COLUMN gerente_lead_stock_pools.pool_consultant_email IS 'E-mail cadastrado no CRM da banca que recebe o estoque (conta pool).';
