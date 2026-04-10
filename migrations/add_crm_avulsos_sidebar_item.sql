-- Item "Avulsos" no submenu CRM + permissões espelhando quem já vê "Transferido"
-- (sidebar dinâmica /api/zaploto/sidebar)

INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
SELECT zt.id, 'crm_avulsos', 'Avulsos', '/crm/avulsos', 'UserPlus', 'crm', 2
FROM zaploto_tenants zt
WHERE NOT EXISTS (
  SELECT 1 FROM zaploto_sidebar_items si
  WHERE si.zaploto_id = zt.id AND si.code = 'crm_avulsos'
);

INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
SELECT zrs.zaploto_id, zrs.role_id, si_av.id, true
FROM zaploto_role_sidebar zrs
JOIN zaploto_sidebar_items si_t ON si_t.id = zrs.sidebar_item_id AND si_t.code = 'crm_transferido'
JOIN zaploto_sidebar_items si_av ON si_av.zaploto_id = zrs.zaploto_id AND si_av.code = 'crm_avulsos'
WHERE zrs.visible = true
ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
