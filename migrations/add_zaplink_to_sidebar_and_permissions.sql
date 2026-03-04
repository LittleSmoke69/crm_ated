-- =====================================================
-- Migration: Adiciona Zaplink ao sidebar inteligente e permissões
-- Data: 2026-03-03
-- Descrição: Insere item Zaplink em zaploto_sidebar_items e visibilidade
--            para super_admin e admin (zaploto_role_sidebar).
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_role_super UUID;
  v_role_admin UUID;
  v_item_zaplink_id UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'Tenant zaploto não encontrado. Pulando migration add_zaplink.';
    RETURN;
  END IF;

  -- Inserir item Zaplink na sidebar (após vsl_redirect, sort_order 23)
  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES (v_zaploto_id, 'zaplink', 'Zaplink', '/admin/zaplink', 'Link2', NULL, 23)
  ON CONFLICT (zaploto_id, code) DO UPDATE SET
    label = EXCLUDED.label,
    href = EXCLUDED.href,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order;

  SELECT id INTO v_item_zaplink_id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'zaplink' LIMIT 1;

  SELECT id INTO v_role_super FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'super_admin' LIMIT 1;
  SELECT id INTO v_role_admin FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'admin' LIMIT 1;

  -- Super Admin vê Zaplink
  IF v_role_super IS NOT NULL AND v_item_zaplink_id IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_super, v_item_zaplink_id, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;

  -- Admin vê Zaplink
  IF v_role_admin IS NOT NULL AND v_item_zaplink_id IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_admin, v_item_zaplink_id, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;

  RAISE NOTICE 'Zaplink adicionado ao sidebar e permissões (super_admin, admin).';
END $$;
