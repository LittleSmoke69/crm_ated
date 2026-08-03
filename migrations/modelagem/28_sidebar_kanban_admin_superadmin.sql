-- =====================================================
-- MODELAGEM 28 — Kanban para admin/super_admin em TODOS os tenants
-- Idempotente. Rode no SQL Editor do Supabase.
-- =====================================================

DO $$
DECLARE
  v_tenant UUID;
  v_item_id UUID;
BEGIN
  FOR v_tenant IN
    SELECT id FROM zaploto_tenants WHERE COALESCE(is_active, true) = true
  LOOP
    -- Garante item CRM pai
    INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order, is_active)
    VALUES (v_tenant, 'crm', 'CRM', NULL, 'Layout', NULL, 10, true)
    ON CONFLICT (zaploto_id, code) DO UPDATE
      SET label = EXCLUDED.label,
          icon_name = EXCLUDED.icon_name,
          parent_code = NULL,
          is_active = true;

    -- Garante item Kanban filho de CRM
    INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order, is_active)
    VALUES (v_tenant, 'crm_kanban', 'Kanban', '/crm/kanban', 'Kanban', 'crm', 0, true)
    ON CONFLICT (zaploto_id, code) DO UPDATE
      SET label = 'Kanban',
          href = '/crm/kanban',
          icon_name = 'Kanban',
          parent_code = 'crm',
          is_active = true;

    SELECT id INTO v_item_id
    FROM zaploto_sidebar_items
    WHERE zaploto_id = v_tenant AND code = 'crm_kanban'
    LIMIT 1;

    IF v_item_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Pai CRM visível para admin/super_admin
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    SELECT v_tenant, r.id, si.id, true
    FROM zaploto_roles r
    JOIN zaploto_sidebar_items si
      ON si.zaploto_id = v_tenant AND si.code = 'crm'
    WHERE r.zaploto_id = v_tenant
      AND r.is_active = true
      AND r.code IN ('super_admin', 'admin', 'captador', 'consultor')
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

    -- Kanban visível para admin/super_admin
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    SELECT v_tenant, r.id, v_item_id, true
    FROM zaploto_roles r
    WHERE r.zaploto_id = v_tenant
      AND r.is_active = true
      AND r.code IN ('super_admin', 'admin')
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

    -- Gerente / suporte: sem Kanban
    UPDATE zaploto_role_sidebar
       SET visible = false
     WHERE sidebar_item_id = v_item_id
       AND role_id IN (
         SELECT id FROM zaploto_roles
         WHERE zaploto_id = v_tenant AND code IN ('gerente', 'suporte')
       );

    -- Captador (e consultor legado): Kanban visível
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    SELECT v_tenant, r.id, v_item_id, true
    FROM zaploto_roles r
    WHERE r.zaploto_id = v_tenant
      AND r.is_active = true
      AND r.code IN ('captador', 'consultor')
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END LOOP;
END $$;
