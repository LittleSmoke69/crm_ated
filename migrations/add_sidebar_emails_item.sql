-- Item de sidebar: "E-mails" (Admin > E-mails — disparo de e-mail: contas SMTP,
-- campanhas de newsletter e histórico, /admin/emails).
-- Visível para super_admin e admin, como item de topo, em TODOS os tenants.
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

    INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
    VALUES (v_tenant.id, 'admin_emails', 'E-mails', '/admin/emails', 'Mail', NULL, 45)
    ON CONFLICT (zaploto_id, code) DO UPDATE
      SET label = EXCLUDED.label,
          href = EXCLUDED.href,
          icon_name = EXCLUDED.icon_name,
          parent_code = EXCLUDED.parent_code,
          sort_order = EXCLUDED.sort_order,
          is_active = true;

    SELECT id INTO v_item_id FROM zaploto_sidebar_items WHERE zaploto_id = v_tenant.id AND code = 'admin_emails' LIMIT 1;
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

  RAISE NOTICE 'Item de sidebar admin_emails (E-mails) criado para super_admin/admin em todos os tenants.';
END $$;
