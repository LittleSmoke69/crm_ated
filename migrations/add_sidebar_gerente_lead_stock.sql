-- Item de sidebar: Estoque de leads (gerente → repasse aos consultores).
-- Sidebar inteligente (zaploto_sidebar_items + zaploto_role_sidebar).

DO $$
DECLARE
  v_zaploto_id UUID;
  v_item_id UUID;
  v_role_gerente UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'add_sidebar_gerente_lead_stock: tenant zaploto não encontrado; pulando.';
    RETURN;
  END IF;

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES (v_zaploto_id, 'gerente_lead_stock', 'Estoque de leads', '/gerente/crm/lead-stock-transfer', 'Package', NULL, 22)
  ON CONFLICT (zaploto_id, code) DO UPDATE
    SET label = EXCLUDED.label,
        href = EXCLUDED.href,
        icon_name = EXCLUDED.icon_name,
        sort_order = EXCLUDED.sort_order;

  SELECT id INTO v_item_id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'gerente_lead_stock' LIMIT 1;
  IF v_item_id IS NULL THEN RETURN;
  END IF;

  SELECT id INTO v_role_gerente FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gerente';

  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  VALUES (v_zaploto_id, v_role_gerente, v_item_id, true)
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  RAISE NOTICE 'Estoque de leads adicionado à sidebar inteligente do gerente.';
END $$;
