-- Item de sidebar: Estoque de leads (gerente).
-- Sem bloco DO/PLpgSQL — funciona em editores que quebram o script por ';' (evita erro "relation v_zaploto_id does not exist").

-- 1) Item na sidebar do tenant 'zaploto'
INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
SELECT z.id,
       'gerente_lead_stock',
       'Estoque de leads',
       '/gerente/crm/lead-stock-transfer',
       'Package',
       NULL,
       22
FROM zaploto_tenants z
WHERE z.slug = 'zaploto'
LIMIT 1
ON CONFLICT (zaploto_id, code)
DO UPDATE SET
  label       = EXCLUDED.label,
  href        = EXCLUDED.href,
  icon_name   = EXCLUDED.icon_name,
  sort_order  = EXCLUDED.sort_order;

-- 2) Cargo gerente enxerga o item (ajuste o slug se seu tenant não for 'zaploto')
INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
SELECT z.id,
       r.id,
       si.id,
       true
FROM zaploto_tenants z
JOIN zaploto_roles r
  ON r.zaploto_id = z.id
 AND r.code = 'gerente'
JOIN zaploto_sidebar_items si
  ON si.zaploto_id = z.id
 AND si.code = 'gerente_lead_stock'
WHERE z.slug = 'zaploto'
ON CONFLICT (role_id, sidebar_item_id)
DO UPDATE SET visible = true;
