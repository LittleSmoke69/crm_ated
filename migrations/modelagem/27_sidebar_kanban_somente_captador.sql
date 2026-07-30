-- =====================================================
-- MODELAGEM 27 — Kanban só para captador (admin/gerente usam Leads)
-- Idempotente. Rode no SQL Editor do Supabase.
-- =====================================================

DO $$
DECLARE
  v_tenant UUID;
  v_item_id UUID;
BEGIN
  SELECT id INTO v_tenant FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM zaploto_tenants ORDER BY created_at ASC NULLS LAST LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'Nenhum tenant encontrado — sidebar kanban não atualizada.';
    RETURN;
  END IF;

  SELECT id INTO v_item_id
  FROM zaploto_sidebar_items
  WHERE zaploto_id = v_tenant
    AND code = 'crm_kanban'
  LIMIT 1;

  IF v_item_id IS NULL THEN
    RAISE NOTICE 'Item crm_kanban não encontrado — nada a atualizar.';
    RETURN;
  END IF;

  -- Esconde Kanban para admin / super_admin / gerente / suporte
  UPDATE zaploto_role_sidebar
     SET visible = false
   WHERE sidebar_item_id = v_item_id
     AND role_id IN (
       SELECT id
       FROM zaploto_roles
       WHERE zaploto_id = v_tenant
         AND code IN ('super_admin', 'admin', 'gerente', 'suporte')
     );

  -- Garante Kanban visível para captador (e consultor legado)
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_tenant, r.id, v_item_id, true
  FROM zaploto_roles r
  WHERE r.zaploto_id = v_tenant
    AND r.is_active = true
    AND r.code IN ('captador', 'consultor')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
END $$;
