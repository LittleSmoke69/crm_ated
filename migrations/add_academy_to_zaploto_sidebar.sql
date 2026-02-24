-- =====================================================
-- Adiciona Academy aos itens da sidebar (Zaploto)
-- Depende: seed_zaploto_default_roles_and_sidebar.sql
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_role_super UUID;
  v_role_admin UUID;
  v_role_suporte UUID;
  v_role_auditoria UUID;
  v_role_dono UUID;
  v_role_gestor UUID;
  v_role_gerente UUID;
  v_role_consultor UUID;
  v_item_academy UUID;
  v_item_academy_admin UUID;
  v_item RECORD;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'Tenant zaploto não encontrado. Ignorando add_academy_to_zaploto_sidebar.';
    RETURN;
  END IF;

  -- Inserir itens Academy na sidebar (raiz + submenu do painel admin)
  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES
    (v_zaploto_id, 'academy', 'Academy', '/academy', 'BookOpen', NULL, 23),
    (v_zaploto_id, 'academy_admin', 'Academy', '/admin/academy', 'BookOpen', NULL, 24),
    (v_zaploto_id, 'academy_admin_dashboard', 'Dashboard', '/admin/academy', 'LayoutDashboard', 'academy_admin', 0),
    (v_zaploto_id, 'academy_admin_modulos', 'Módulos', '/admin/academy/modulos', 'Briefcase', 'academy_admin', 1),
    (v_zaploto_id, 'academy_admin_aulas', 'Aulas', '/admin/academy/aulas', 'Activity', 'academy_admin', 2),
    (v_zaploto_id, 'academy_admin_assets', 'Materiais', '/admin/academy/assets', 'ListOrdered', 'academy_admin', 3),
    (v_zaploto_id, 'academy_admin_analytics', 'Analytics', '/admin/academy/analytics', 'BarChart3', 'academy_admin', 4)
  ON CONFLICT (zaploto_id, code) DO NOTHING;

  SELECT id INTO v_item_academy FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'academy' LIMIT 1;
  SELECT id INTO v_item_academy_admin FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'academy_admin' LIMIT 1;

  IF v_item_academy IS NULL OR v_item_academy_admin IS NULL THEN
    RAISE NOTICE 'Itens academy não encontrados após insert.';
    RETURN;
  END IF;

  SELECT id INTO v_role_super FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'super_admin';
  SELECT id INTO v_role_admin FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'admin';
  SELECT id INTO v_role_suporte FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'suporte';
  SELECT id INTO v_role_auditoria FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'auditoria';
  SELECT id INTO v_role_dono FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'dono_banca';
  SELECT id INTO v_role_gestor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gestor';
  SELECT id INTO v_role_gerente FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gerente';
  SELECT id INTO v_role_consultor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'consultor';

  -- Super Admin e Admin: Academy (painel admin) + submenu (dashboard, módulos, aulas, materiais, analytics)
  FOR v_item IN
    SELECT id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND (code = 'academy_admin' OR parent_code = 'academy_admin')
  LOOP
    IF v_role_super IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_super, v_item.id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;
    IF v_role_admin IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_admin, v_item.id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;
  END LOOP;

  -- Demais cargos: Academy (área pública)
  IF v_role_suporte IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_suporte, v_item_academy, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;
  IF v_role_auditoria IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_auditoria, v_item_academy, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;
  IF v_role_dono IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_dono, v_item_academy, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;
  IF v_role_gestor IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_gestor, v_item_academy, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;
  IF v_role_gerente IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_gerente, v_item_academy, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;
  IF v_role_consultor IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_consultor, v_item_academy, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;

END $$;
