-- =====================================================
-- Migration: user_bancas - coluna banca_id -> banca_ids JSONB
-- Data: 2026-02-17
-- Descrição: Gerentes e consultores podem estar atribuídos a mais de uma banca.
--            Substitui várias linhas (user_id, banca_id) por uma linha por usuário
--            com banca_ids JSONB (array de UUIDs em string).
-- =====================================================

-- 0) Remover políticas em outras tabelas que dependem de user_bancas (antes do DROP TABLE)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_campaigns') THEN
    DROP POLICY IF EXISTS "Gestor can read meta_campaigns for assigned bancas" ON meta_campaigns;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_adsets') THEN
    DROP POLICY IF EXISTS "Gestor can read meta_adsets for assigned bancas" ON meta_adsets;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_insights_daily') THEN
    DROP POLICY IF EXISTS "Gestor can read meta_insights_daily for assigned bancas" ON meta_insights_daily;
  END IF;
END $$;

-- 1) Criar nova tabela com estrutura (user_id PK, banca_ids JSONB)
CREATE TABLE IF NOT EXISTS user_bancas_new (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banca_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  PRIMARY KEY (user_id)
);

COMMENT ON TABLE user_bancas_new IS 'Bancas em que o usuário (consultor, gerente ou gestor) atua; banca_ids é array de UUIDs; uma linha por usuário';

-- 2) Migrar dados: agrupar por user_id e agregar banca_id em array JSONB
INSERT INTO user_bancas_new (user_id, banca_ids, created_at)
SELECT user_id, jsonb_agg(banca_id::text ORDER BY banca_id), MIN(created_at)
FROM user_bancas
GROUP BY user_id;

-- 3) Remover tabela antiga (drop policies já são implícitos no drop table)
DROP TABLE IF EXISTS user_bancas;

-- 4) Renomear nova tabela para user_bancas
ALTER TABLE user_bancas_new RENAME TO user_bancas;

-- 5) Índices
CREATE INDEX IF NOT EXISTS idx_user_bancas_user_id ON user_bancas(user_id);
-- Índice GIN para consultas "banca_ids contém banca_id" (ex: filtrar usuários de uma banca)
CREATE INDEX IF NOT EXISTS idx_user_bancas_banca_ids_gin ON user_bancas USING GIN (banca_ids);

-- 6) RLS
ALTER TABLE user_bancas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own user_bancas"
  ON user_bancas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Consultor Gerente Gestor SuperAdmin can manage own user_bancas"
  ON user_bancas FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('consultor', 'gerente', 'super_admin', 'gestor')
    )
  );

COMMENT ON COLUMN user_bancas.banca_ids IS 'Array de IDs (UUID em string) das bancas em que o usuário atua';

-- 7) Recriar políticas RLS do Meta Ads que usam user_bancas (gestor por banca)
-- Agora com ub.banca_ids @> jsonb_build_array(...) em vez de ub.banca_id = ...
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_campaigns') THEN
    CREATE POLICY "Gestor can read meta_campaigns for assigned bancas"
  ON meta_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id AND ub.banca_ids @> jsonb_build_array(meta_campaigns.banca_id::text)
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_adsets') THEN
    CREATE POLICY "Gestor can read meta_adsets for assigned bancas"
  ON meta_adsets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id AND ub.banca_ids @> jsonb_build_array(meta_adsets.banca_id::text)
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_insights_daily') THEN
    CREATE POLICY "Gestor can read meta_insights_daily for assigned bancas"
  ON meta_insights_daily FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id AND ub.banca_ids @> jsonb_build_array(meta_insights_daily.banca_id::text)
      WHERE p.id = auth.uid()
      AND p.status IN ('gestor', 'super_admin', 'admin')
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin')
    )
  );
  END IF;
END $$;
