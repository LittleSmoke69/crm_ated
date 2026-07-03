-- =====================================================
-- MODELAGEM 06 — NÚCLEO ISOLADO (runtime compartilhado + menu só das features usadas)
-- Objetivo: fazer o app rodar SÓ com o que a modelagem usa (CRM Kanban, chat oficial,
--           ADS, acesso), sem precisar das 231 migrations. Completa o núcleo que TODA
--           página toca (profiles/tenant/sidebar/user_bancas) e semeia o menu apenas
--           com as features provisionadas — o resto some do sidebar.
-- Idempotente. Rode DEPOIS de 00–05.
-- =====================================================

-- 1) zaploto_tenants: coluna is_central (selecionada explicitamente pelo tenant service).
ALTER TABLE zaploto_tenants
  ADD COLUMN IF NOT EXISTS is_central BOOLEAN NOT NULL DEFAULT false;

UPDATE zaploto_tenants SET is_central = true WHERE slug = 'zaploto';

-- 2) user_bancas: /api/user/profile lê banca_ids (uma linha por usuário).
CREATE TABLE IF NOT EXISTS user_bancas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banca_ids  JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE user_bancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_bancas_owner ON user_bancas;
CREATE POLICY user_bancas_owner ON user_bancas FOR ALL USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin'))
);

-- 3) Sidebar: semeia SOMENTE os itens das features usadas e liga aos 4 cargos.
--    Com itens presentes, o loader deixa de usar o menu legado (hardcoded) e
--    passa a mostrar apenas o que está aqui — isolando as features não usadas.
DO $$
DECLARE
  v_tenant UUID;
  v_role   RECORD;
BEGIN
  SELECT id INTO v_tenant FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_tenant IS NULL THEN RAISE NOTICE 'tenant zaploto ausente'; RETURN; END IF;

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order) VALUES
    (v_tenant, 'painel_admin',     'Painel Administrativo','/admin',           'Shield',          NULL,  1),
    (v_tenant, 'crm',              'CRM',                NULL,                 'Layout',          NULL, 10),
    (v_tenant, 'crm_kanban',       'Kanban',             '/crm/kanban',        'Kanban',          'crm', 0),
    (v_tenant, 'chat_atendimento', 'Chat de Atendimento','/chat',              'MessageSquare',   NULL, 11),
    (v_tenant, 'chat_gestao',      'Gestão do Chat',     '/admin/chat-gestao', 'BarChart3',       NULL, 12),
    (v_tenant, 'profile',          'Meu Perfil',         '/perfil',            'User',            NULL, 99)
  ON CONFLICT (zaploto_id, code) DO UPDATE
    SET label = EXCLUDED.label, href = EXCLUDED.href, icon_name = EXCLUDED.icon_name,
        parent_code = EXCLUDED.parent_code, sort_order = EXCLUDED.sort_order, is_active = true;

  -- Liga os 4 cargos aos itens comuns (visíveis a todos).
  FOR v_role IN
    SELECT id FROM zaploto_roles
     WHERE zaploto_id = v_tenant AND is_active = true
       AND code IN ('super_admin','admin','suporte','consultor')
  LOOP
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    SELECT v_tenant, v_role.id, si.id, true
    FROM zaploto_sidebar_items si
    WHERE si.zaploto_id = v_tenant
      AND si.code IN ('crm','crm_kanban','chat_atendimento','chat_gestao','profile')
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END LOOP;

  -- Painel Administrativo: só super_admin e admin.
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_tenant, r.id, si.id, true
  FROM zaploto_roles r
  JOIN zaploto_sidebar_items si ON si.zaploto_id = v_tenant AND si.code = 'painel_admin'
  WHERE r.zaploto_id = v_tenant AND r.code IN ('super_admin','admin')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
END $$;
