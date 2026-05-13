-- Renomeia apenas o rótulo exibido da opção de sidebar, mantendo código, rota e permissões.
UPDATE zaploto_sidebar_items
SET label = 'Desempenho'
WHERE code = 'meu_desempenho'
  AND label = 'Meu Desempenho';
