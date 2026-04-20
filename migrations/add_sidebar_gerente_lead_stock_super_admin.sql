-- Libera o item "Estoque de leads" para super_admin no tenant zaploto.
-- Mantém o mesmo item já existente: code = 'gerente_lead_stock'.

INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
SELECT z.id,
       r.id,
       si.id,
       true
FROM zaploto_tenants z
JOIN zaploto_roles r
  ON r.zaploto_id = z.id
 AND r.code = 'super_admin'
JOIN zaploto_sidebar_items si
  ON si.zaploto_id = z.id
 AND si.code = 'gerente_lead_stock'
WHERE z.slug = 'zaploto'
ON CONFLICT (role_id, sidebar_item_id)
DO UPDATE SET visible = true;
