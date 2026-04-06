-- Item de sidebar: Transferência de Leads (admin + gerente + auditoria na sidebar inteligente).
-- Depende: seed_zaploto_default_roles_and_sidebar.sql (tenant zaploto, tabelas zaploto_*)

DO $$
DECLARE
  v_zaploto_id UUID;
  v_item_id UUID;
  v_role_super UUID;
  v_role_admin UUID;
  v_role_auditoria UUID;
  v_role_gerente UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'add_sidebar_lead_transfer_item: tenant zaploto não encontrado; pulando.';
    RETURN;
  END IF;

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES (v_zaploto_id, 'lead_transfer', 'Transferência de Leads', '/admin/crm/lead-transfer', 'ArrowRightLeft', NULL, 23)
  ON CONFLICT (zaploto_id, code) DO UPDATE
    SET label = EXCLUDED.label,
        href = EXCLUDED.href,
        icon_name = EXCLUDED.icon_name,
        sort_order = EXCLUDED.sort_order;

  SELECT id INTO v_item_id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'lead_transfer' LIMIT 1;
  IF v_item_id IS NULL THEN RETURN;
  END IF;

  SELECT id INTO v_role_super FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'super_admin';
  SELECT id INTO v_role_admin FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'admin';
  SELECT id INTO v_role_auditoria FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'auditoria';
  SELECT id INTO v_role_gerente FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gerente';

  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, r.role_id, v_item_id, true
  FROM (VALUES
    (v_role_super),
    (v_role_admin),
    (v_role_auditoria),
    (v_role_gerente)
  ) AS r(role_id)
  WHERE r.role_id IS NOT NULL
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
END $$;
