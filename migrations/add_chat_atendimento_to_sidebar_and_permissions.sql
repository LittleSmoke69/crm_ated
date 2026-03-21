-- =====================================================
-- Migration: Adiciona Chat Atendimento ao sidebar inteligente e permissões
-- Data: 2026-03-20
-- Descrição: Insere itens chat_atendimento, gerente_atendimento_chat,
--            relatorio_chat e etiquetas_chat em zaploto_sidebar_items
--            e configura visibilidade por cargo em zaploto_role_sidebar.
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_role_super UUID;
  v_role_admin UUID;
  v_role_gerente UUID;
  v_role_consultor UUID;
  v_item_chat_atendimento_id UUID;
  v_item_gerente_atendimento_id UUID;
  v_item_relatorio_chat_id UUID;
  v_item_etiquetas_chat_id UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'Tenant zaploto não encontrado. Pulando migration add_chat_atendimento.';
    RETURN;
  END IF;

  -- =====================================================
  -- 1. Inserir itens na sidebar
  -- =====================================================

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES (v_zaploto_id, 'chat_atendimento', 'Chat Atendimento', '/chat-atendimento', 'Headphones', NULL, 25)
  ON CONFLICT (zaploto_id, code) DO UPDATE SET
    label = EXCLUDED.label,
    href = EXCLUDED.href,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order;

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES (v_zaploto_id, 'gerente_atendimento_chat', 'Instâncias Atendimento', '/gerente/atendimento-chat', 'MessageSquare', NULL, 26)
  ON CONFLICT (zaploto_id, code) DO UPDATE SET
    label = EXCLUDED.label,
    href = EXCLUDED.href,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order;

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES (v_zaploto_id, 'relatorio_chat', 'Relatório Chat', '/admin/chat-report', 'Headphones', NULL, 27)
  ON CONFLICT (zaploto_id, code) DO UPDATE SET
    label = EXCLUDED.label,
    href = EXCLUDED.href,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order;

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES (v_zaploto_id, 'etiquetas_chat', 'Etiquetas Chat', '/admin/chat-tags', 'MessageSquare', NULL, 28)
  ON CONFLICT (zaploto_id, code) DO UPDATE SET
    label = EXCLUDED.label,
    href = EXCLUDED.href,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order;

  -- =====================================================
  -- 2. Obter IDs dos itens inseridos
  -- =====================================================

  SELECT id INTO v_item_chat_atendimento_id
    FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'chat_atendimento' LIMIT 1;

  SELECT id INTO v_item_gerente_atendimento_id
    FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'gerente_atendimento_chat' LIMIT 1;

  SELECT id INTO v_item_relatorio_chat_id
    FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'relatorio_chat' LIMIT 1;

  SELECT id INTO v_item_etiquetas_chat_id
    FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'etiquetas_chat' LIMIT 1;

  -- =====================================================
  -- 3. Obter IDs dos cargos
  -- =====================================================

  SELECT id INTO v_role_super FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'super_admin' LIMIT 1;
  SELECT id INTO v_role_admin FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'admin' LIMIT 1;
  SELECT id INTO v_role_gerente FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gerente' LIMIT 1;
  SELECT id INTO v_role_consultor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'consultor' LIMIT 1;

  -- =====================================================
  -- 4. Permissões: Super Admin
  --    Vê: chat_atendimento, gerente_atendimento_chat, relatorio_chat, etiquetas_chat
  -- =====================================================

  IF v_role_super IS NOT NULL THEN
    IF v_item_chat_atendimento_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_super, v_item_chat_atendimento_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    IF v_item_gerente_atendimento_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_super, v_item_gerente_atendimento_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    IF v_item_relatorio_chat_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_super, v_item_relatorio_chat_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    IF v_item_etiquetas_chat_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_super, v_item_etiquetas_chat_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;
  END IF;

  -- =====================================================
  -- 5. Permissões: Admin
  --    Vê: relatorio_chat, etiquetas_chat
  -- =====================================================

  IF v_role_admin IS NOT NULL THEN
    IF v_item_relatorio_chat_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_admin, v_item_relatorio_chat_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    IF v_item_etiquetas_chat_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_admin, v_item_etiquetas_chat_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;
  END IF;

  -- =====================================================
  -- 6. Permissões: Gerente
  --    Vê: chat_atendimento, gerente_atendimento_chat
  -- =====================================================

  IF v_role_gerente IS NOT NULL THEN
    IF v_item_chat_atendimento_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_gerente, v_item_chat_atendimento_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    IF v_item_gerente_atendimento_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_gerente, v_item_gerente_atendimento_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;
  END IF;

  -- =====================================================
  -- 7. Permissões: Consultor
  --    Vê: chat_atendimento
  -- =====================================================

  IF v_role_consultor IS NOT NULL THEN
    IF v_item_chat_atendimento_id IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_zaploto_id, v_role_consultor, v_item_chat_atendimento_id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;
  END IF;

  RAISE NOTICE 'Chat Atendimento e itens relacionados adicionados ao sidebar e permissões.';
END $$;
