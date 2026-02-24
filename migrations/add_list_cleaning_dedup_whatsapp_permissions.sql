-- =====================================================
-- Migration: Permissões separadas para Limpeza de Lista
-- Data: 2026-02-24
-- Depende: seed_zaploto_default_roles_and_sidebar.sql
-- Descrição: Adiciona list_cleaning_dedup e list_cleaning_whatsapp como sub-permissões
--            para permitir desativar dedup ou verificação WhatsApp por cargo.
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_list_cleaning_id UUID;
  v_dedup_id UUID;
  v_whatsapp_id UUID;
  r RECORD;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RETURN; -- tenant não existe, pular
  END IF;

  SELECT id INTO v_list_cleaning_id
  FROM zaploto_sidebar_items
  WHERE zaploto_id = v_zaploto_id AND code = 'list_cleaning' LIMIT 1;
  IF v_list_cleaning_id IS NULL THEN
    RETURN;
  END IF;

  -- Inserir itens de permissão (href=null: não aparecem no menu, apenas no gerenciamento de cargos)
  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES
    (v_zaploto_id, 'list_cleaning_dedup', 'Limpeza de duplicados', NULL, NULL, 'list_cleaning', 0),
    (v_zaploto_id, 'list_cleaning_whatsapp', 'Limpeza de WhatsApp ativos', NULL, NULL, 'list_cleaning', 1)
  ON CONFLICT (zaploto_id, code) DO NOTHING;

  SELECT id INTO v_dedup_id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'list_cleaning_dedup' LIMIT 1;
  SELECT id INTO v_whatsapp_id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'list_cleaning_whatsapp' LIMIT 1;

  IF v_dedup_id IS NULL OR v_whatsapp_id IS NULL THEN
    RETURN;
  END IF;

  -- Para cada role que tem list_cleaning visível, adicionar dedup e whatsapp visíveis
  FOR r IN
    SELECT DISTINCT role_id
    FROM zaploto_role_sidebar
    WHERE zaploto_id = v_zaploto_id
      AND sidebar_item_id = v_list_cleaning_id
      AND visible = true
  LOOP
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, r.role_id, v_dedup_id, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, r.role_id, v_whatsapp_id, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END LOOP;

END $$;
