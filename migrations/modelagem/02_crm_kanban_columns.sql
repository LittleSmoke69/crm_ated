-- =====================================================
-- MODELAGEM 02 — CRM KANBAN CONFIGURÁVEL
-- Objetivo: transformar as colunas hardcoded do Kanban (hoje derivadas por
--           contagem de depósito em app/crm/kanban/page.tsx) em DADOS, e
--           persistir a posição/estágio de cada lead (drag-and-drop real).
--           Termina o fluxo da loteria e habilita gestão de clientes.
-- Depende: create_crm_leads_table.sql, create_crm_tags_table.sql,
--          create_zaploto_tenants_and_roles.sql (zaploto_id opcional)
-- Idempotente. NÃO recria o banco.
-- =====================================================

-- 1) CATÁLOGO DE COLUNAS (estágios do funil) -----------------------------------
CREATE TABLE IF NOT EXISTS crm_columns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id  UUID REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,                 -- ex: 'novo', 'deposito_1x' (bate com a lógica atual)
  title       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'gray',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_system   BOOLEAN NOT NULL DEFAULT false,-- true = coluna derivada da loteria (não deletável)
  is_active   BOOLEAN NOT NULL DEFAULT true,
  wip_limit   INTEGER,                       -- limite opcional de cards (gestão de clientes)
  -- Regra automática (opcional). Quando preenchida, o front pode classificar o
  -- lead nesta coluna; quando o lead é arrastado manualmente, crm_lead_stage vence.
  auto_rule   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zaploto_id, key)
);

CREATE INDEX IF NOT EXISTS idx_crm_columns_zaploto_order
  ON crm_columns (zaploto_id, sort_order);

COMMENT ON TABLE crm_columns IS 'Estágios/colunas do Kanban do CRM, por tenant. Substitui as colunas hardcoded.';
COMMENT ON COLUMN crm_columns.auto_rule IS 'Regra de classificação automática (JSON). Ex: {"type":"deposit_count","op":"gte","value":3}.';

-- 2) POSIÇÃO PERSISTIDA DO LEAD (drag-and-drop) --------------------------------
--    Mantém a convenção de crm_lead_tags: lead identificado por (lead_external_id, user_id).
CREATE TABLE IF NOT EXISTS crm_lead_stage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_external_id TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  column_id       UUID NOT NULL REFERENCES crm_columns(id) ON DELETE CASCADE,
  column_key      TEXT NOT NULL,             -- denormalizado p/ leitura rápida no front
  position        INTEGER NOT NULL DEFAULT 0,-- ordem dentro da coluna
  is_manual       BOOLEAN NOT NULL DEFAULT true, -- true = movido à mão (ignora auto_rule)
  moved_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  moved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_external_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_column
  ON crm_lead_stage (column_id, position);
CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_user
  ON crm_lead_stage (user_id);

COMMENT ON TABLE crm_lead_stage IS 'Estágio/posição atual de cada lead no Kanban (persistência do drag-and-drop).';

-- 3) HISTÓRICO DE MOVIMENTAÇÃO (métrica de funil) ------------------------------
CREATE TABLE IF NOT EXISTS crm_lead_stage_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_external_id TEXT NOT NULL,
  user_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  from_column_key  TEXT,
  to_column_key    TEXT NOT NULL,
  moved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  moved_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_history_lead
  ON crm_lead_stage_history (lead_external_id, user_id, moved_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_lead_stage_history_to
  ON crm_lead_stage_history (to_column_key, moved_at DESC);

COMMENT ON TABLE crm_lead_stage_history IS 'Log append-only de mudanças de coluna para métricas de conversão de funil.';

-- 4) SEED DO FUNIL DE GESTÃO DE CLIENTES ---------------------------------------
--    Estágios genéricos (sem loteria). auto_rule = NULL: são manuais (drag-and-drop).
--    is_system = false: o admin pode editar, reordenar, adicionar e remover colunas.
DO $$
DECLARE
  v_zaploto_id UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;

  INSERT INTO crm_columns (zaploto_id, key, title, color, sort_order, is_system, auto_rule) VALUES
    (v_zaploto_id, 'novo',        '🆕 Novo lead',        'gray',    0, false, NULL),
    (v_zaploto_id, 'contatado',   '📞 Contatado',        'blue',    1, false, NULL),
    (v_zaploto_id, 'qualificado', '✅ Qualificado',      'indigo',  2, false, NULL),
    (v_zaploto_id, 'proposta',    '📄 Proposta enviada', 'amber',   3, false, NULL),
    (v_zaploto_id, 'negociacao',  '🤝 Em negociação',    'orange',  4, false, NULL),
    (v_zaploto_id, 'ganho',       '🏆 Cliente ganho',    'emerald', 5, false, NULL),
    (v_zaploto_id, 'perdido',     '❌ Perdido',          'rose',    6, false, NULL)
  ON CONFLICT (zaploto_id, key) DO UPDATE
    SET title = EXCLUDED.title,
        color = EXCLUDED.color,
        sort_order = EXCLUDED.sort_order,
        auto_rule = EXCLUDED.auto_rule,
        updated_at = now();
END $$;

-- 5) RLS ------------------------------------------------------------------------
ALTER TABLE crm_columns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_stage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_stage_history ENABLE ROW LEVEL SECURITY;

-- Colunas: todos autenticados leem; admin/super_admin gerenciam.
DROP POLICY IF EXISTS crm_columns_read ON crm_columns;
CREATE POLICY crm_columns_read ON crm_columns
  FOR SELECT USING (true);

DROP POLICY IF EXISTS crm_columns_admin_write ON crm_columns;
CREATE POLICY crm_columns_admin_write ON crm_columns
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
            AND p.status IN ('super_admin','admin'))
  );

-- Estágio do lead: dono vê/edita o seu; admin/suporte veem todos.
DROP POLICY IF EXISTS crm_lead_stage_owner ON crm_lead_stage;
CREATE POLICY crm_lead_stage_owner ON crm_lead_stage
  FOR ALL USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
               AND p.status IN ('super_admin','admin','suporte'))
  );

DROP POLICY IF EXISTS crm_lead_stage_history_read ON crm_lead_stage_history;
CREATE POLICY crm_lead_stage_history_read ON crm_lead_stage_history
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
               AND p.status IN ('super_admin','admin','suporte'))
  );

DROP POLICY IF EXISTS crm_lead_stage_history_insert ON crm_lead_stage_history;
CREATE POLICY crm_lead_stage_history_insert ON crm_lead_stage_history
  FOR INSERT WITH CHECK (true);

-- 6) RPC: mover lead de coluna (persiste posição + grava histórico) -------------
CREATE OR REPLACE FUNCTION crm_move_lead(
  p_lead_external_id TEXT,
  p_user_id          UUID,
  p_column_key       TEXT,
  p_position         INTEGER DEFAULT 0,
  p_moved_by         UUID DEFAULT NULL
) RETURNS crm_lead_stage AS $$
DECLARE
  v_col   crm_columns%ROWTYPE;
  v_prev  TEXT;
  v_row   crm_lead_stage%ROWTYPE;
BEGIN
  SELECT * INTO v_col FROM crm_columns
   WHERE key = p_column_key AND is_active = true
   ORDER BY (zaploto_id IS NULL) LIMIT 1;
  IF v_col.id IS NULL THEN
    RAISE EXCEPTION 'Coluna % inexistente ou inativa', p_column_key;
  END IF;

  SELECT column_key INTO v_prev FROM crm_lead_stage
   WHERE lead_external_id = p_lead_external_id AND user_id = p_user_id;

  INSERT INTO crm_lead_stage (lead_external_id, user_id, column_id, column_key, position, is_manual, moved_by, moved_at, updated_at)
  VALUES (p_lead_external_id, p_user_id, v_col.id, v_col.key, p_position, true, COALESCE(p_moved_by, p_user_id), now(), now())
  ON CONFLICT (lead_external_id, user_id) DO UPDATE
    SET column_id = EXCLUDED.column_id,
        column_key = EXCLUDED.column_key,
        position   = EXCLUDED.position,
        is_manual  = true,
        moved_by   = EXCLUDED.moved_by,
        moved_at   = now(),
        updated_at = now()
  RETURNING * INTO v_row;

  IF v_prev IS DISTINCT FROM v_col.key THEN
    INSERT INTO crm_lead_stage_history (lead_external_id, user_id, from_column_key, to_column_key, moved_by)
    VALUES (p_lead_external_id, p_user_id, v_prev, v_col.key, COALESCE(p_moved_by, p_user_id));
  END IF;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION crm_move_lead IS 'Move um lead para uma coluna do Kanban, persistindo posição e registrando histórico.';
