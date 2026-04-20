-- Visibilidade de "Meu Desempenho" para dono de banca e gestor de tráfego (sidebar dinâmica).

INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
SELECT z.id,
       r.id,
       si.id,
       true
FROM zaploto_tenants z
JOIN zaploto_roles r
  ON r.zaploto_id = z.id
 AND r.code IN ('dono_banca', 'gestor')
JOIN zaploto_sidebar_items si
  ON si.zaploto_id = z.id
 AND si.code = 'meu_desempenho'
WHERE z.slug = 'zaploto'
ON CONFLICT (role_id, sidebar_item_id)
DO UPDATE SET visible = true;
