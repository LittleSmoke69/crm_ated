-- =====================================================
-- Migration: Unifica sidebar — Gestão do Chat
-- Substitui gerente_atendimento_chat, relatorio_chat e etiquetas_chat
-- por um único item gestao_chat → /admin/chat-gestao
-- =====================================================

DO $$
DECLARE
  tenant_id UUID;
  v_new_id UUID;
BEGIN
  FOR tenant_id IN
    SELECT DISTINCT si.zaploto_id
    FROM zaploto_sidebar_items si
    WHERE si.code IN ('gerente_atendimento_chat', 'relatorio_chat', 'etiquetas_chat')
  LOOP
    INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order, is_active)
    VALUES (tenant_id, 'gestao_chat', 'Gestão do Chat', '/admin/chat-gestao', 'BarChart3', NULL, 26, true)
    ON CONFLICT (zaploto_id, code) DO UPDATE SET
      label = EXCLUDED.label,
      href = EXCLUDED.href,
      icon_name = EXCLUDED.icon_name,
      sort_order = EXCLUDED.sort_order,
      is_active = true;

    SELECT id INTO v_new_id
    FROM zaploto_sidebar_items
    WHERE zaploto_id = tenant_id AND code = 'gestao_chat'
    LIMIT 1;

    IF v_new_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT DISTINCT zrs.zaploto_id, zrs.role_id, v_new_id, true
      FROM zaploto_role_sidebar zrs
      INNER JOIN zaploto_sidebar_items si ON si.id = zrs.sidebar_item_id
      WHERE si.zaploto_id = tenant_id
        AND si.code IN ('gerente_atendimento_chat', 'relatorio_chat', 'etiquetas_chat')
        AND zrs.visible = true
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    UPDATE zaploto_sidebar_items
    SET is_active = false
    WHERE zaploto_id = tenant_id
      AND code IN ('gerente_atendimento_chat', 'relatorio_chat', 'etiquetas_chat');

    UPDATE zaploto_role_sidebar zrs
    SET visible = false
    FROM zaploto_sidebar_items si
    WHERE si.id = zrs.sidebar_item_id
      AND si.zaploto_id = tenant_id
      AND si.code IN ('gerente_atendimento_chat', 'relatorio_chat', 'etiquetas_chat');
  END LOOP;

  RAISE NOTICE 'Sidebar: gestao_chat unificado; itens antigos desativados.';
END $$;
