-- =====================================================
-- Migration: Rodadas de investimento de ADS por consultor
-- Descrição: Cada rodada define uma janela (data_inicial..data_final) e uma meta
--   de gasto (ex.: 2000 / 4000 / flexível) para UM consultor. Serve a barra de
--   progresso (gasto real Meta Ads ÷ meta) e o LTV do período no /admin/meta.
-- Gasto real vem de meta_insights_daily (campanhas atribuídas ao consultor);
-- LTV/depósitos vêm do CRM `/api/crm/dashboard-metrics?consultant=email`.
-- =====================================================

CREATE TABLE IF NOT EXISTS meta_investment_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  consultor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Email guardado para chamar dashboard-metrics sem join extra (snapshot do consultor).
  consultor_email TEXT NOT NULL,
  data_inicial DATE NOT NULL,
  data_final DATE NOT NULL,
  -- Meta de gasto de ADS da rodada (BRL). Flexível: 2000, 4000, ou qualquer valor.
  meta_gasto NUMERIC NOT NULL CHECK (meta_gasto > 0),
  label TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (data_final >= data_inicial)
);

CREATE INDEX IF NOT EXISTS idx_meta_investment_rounds_banca
  ON meta_investment_rounds (banca_id);

CREATE INDEX IF NOT EXISTS idx_meta_investment_rounds_consultor
  ON meta_investment_rounds (consultor_id, data_inicial DESC);

COMMENT ON TABLE meta_investment_rounds IS
  'Rodadas de investimento de ADS por consultor (janela + meta de gasto) para barra de progresso e LTV no /admin/meta.';

-- RLS: somente admin/super_admin gerenciam (mesma política das demais tabelas Meta).
ALTER TABLE meta_investment_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage meta_investment_rounds" ON meta_investment_rounds;
CREATE POLICY "Admins can manage meta_investment_rounds"
  ON meta_investment_rounds FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );

-- Gestor/Gerente/Consultor podem LER as rodadas das bancas atribuídas a eles.
-- user_bancas usa banca_ids JSONB (array de UUID em string) — ver user_bancas_banca_ids_jsonb.sql.
DROP POLICY IF EXISTS "Assigned users can read meta_investment_rounds" ON meta_investment_rounds;
CREATE POLICY "Assigned users can read meta_investment_rounds"
  ON meta_investment_rounds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
        AND ub.banca_ids @> jsonb_build_array(meta_investment_rounds.banca_id::text)
      WHERE p.id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );
