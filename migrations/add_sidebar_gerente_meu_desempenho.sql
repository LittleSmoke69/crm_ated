-- Meu Desempenho: visibilidade para o cargo gerente (sidebar dinâmica / hasSidebarPermission).
-- O item `meu_desempenho` já existe no seed; aqui só liga o role `gerente` ao item.

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
 AND si.code = 'meu_desempenho'
WHERE z.slug = 'zaploto'
ON CONFLICT (role_id, sidebar_item_id)
DO UPDATE SET visible = true;
