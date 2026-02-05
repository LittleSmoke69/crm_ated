-- =====================================================
-- Migration: Tabela user_bancas - bancas em que consultor/gerente atuam
-- Data: 2026-02-04
-- Descrição: Permite que consultor e gerente escolham em quais bancas atuam (Meu Perfil).
-- =====================================================

CREATE TABLE IF NOT EXISTS user_bancas (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (user_id, banca_id)
);

CREATE INDEX IF NOT EXISTS idx_user_bancas_user_id ON user_bancas(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bancas_banca_id ON user_bancas(banca_id);

COMMENT ON TABLE user_bancas IS 'Bancas em que o usuário (consultor ou gerente) atua; usado em Meu Perfil para seleção';

ALTER TABLE user_bancas ENABLE ROW LEVEL SECURITY;

-- Usuário pode ver e alterar apenas suas próprias associações
CREATE POLICY "Users can read own user_bancas"
  ON user_bancas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Consultor and Gerente can manage own user_bancas"
  ON user_bancas FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('consultor', 'gerente')
    )
  );
