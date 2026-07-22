-- Item de sidebar: "Leads" (Admin > CRM > Leads — gestão de leads capturados, /admin/leads).
-- Visível para super_admin e admin, no submenu do grupo CRM, em TODOS os tenants.
-- Depende: create_zaploto_tenants_and_roles.sql, seed_zaploto_default_roles_and_sidebar.sql
-- Idempotente: pode rodar mais de uma vez.

DO $$
DECLARE
  v_tenant RECORD;
  v_item_id UUID;
  v_role_super UUID;
  v_role_admin UUID;
BEGIN
  FOR v_tenant IN SELECT id FROM zaploto_tenants LOOP

    -- Garante o item pai "CRM" (tenants antigos podem não ter)
    INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
    VALUES (v_tenant.id, 'crm', 'CRM', NULL, 'Layout', NULL, 10)
    ON CONFLICT (zaploto_id, code) DO NOTHING;

    -- Item "Leads" dentro do grupo CRM (sort_order -1 = primeiro do submenu)
    INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
    VALUES (v_tenant.id, 'crm_leads', 'Leads', '/admin/leads', 'UserPlus', 'crm', -1)
    ON CONFLICT (zaploto_id, code) DO UPDATE
      SET label = EXCLUDED.label,
          href = EXCLUDED.href,
          icon_name = EXCLUDED.icon_name,
          parent_code = EXCLUDED.parent_code,
          sort_order = EXCLUDED.sort_order,
          is_active = true;

    SELECT id INTO v_item_id FROM zaploto_sidebar_items WHERE zaploto_id = v_tenant.id AND code = 'crm_leads' LIMIT 1;
    SELECT id INTO v_role_super FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'super_admin';
    SELECT id INTO v_role_admin FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'admin';

    IF v_item_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT v_tenant.id, r.role_id, v_item_id, true
      FROM (VALUES (v_role_super), (v_role_admin)) AS r(role_id)
      WHERE r.role_id IS NOT NULL
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

  END LOOP;

  RAISE NOTICE 'Item de sidebar crm_leads (Leads) criado para super_admin/admin em todos os tenants.';
END $$;
