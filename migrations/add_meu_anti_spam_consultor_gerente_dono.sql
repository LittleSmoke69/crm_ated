-- =====================================================
-- Migration: Garantir Meu Anti-Spam para consultor, gerente, dono_banca
-- Data: 2026-02-24
-- Depende: seed_zaploto_default_roles_and_sidebar.sql (zaploto_roles, zaploto_sidebar_items, zaploto_role_sidebar)
-- Descrição: Garante que consultores, gerentes e donos de banca tenham acesso e permissão ao Meu Anti-Spam (/anti-spam).
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_role_dono UUID;
  v_role_gerente UUID;
  v_role_consultor UUID;
  v_item_meu_anti_spam UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'Tenant zaploto não encontrado. Migration ignorada.';
    RETURN;
  END IF;

  SELECT id INTO v_item_meu_anti_spam FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'meu_anti_spam' LIMIT 1;
  IF v_item_meu_anti_spam IS NULL THEN
    RAISE NOTICE 'Sidebar item meu_anti_spam não encontrado. Execute seed_zaploto_default_roles_and_sidebar.sql antes.';
    RETURN;
  END IF;

  SELECT id INTO v_role_dono FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'dono_banca' LIMIT 1;
  SELECT id INTO v_role_gerente FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gerente' LIMIT 1;
  SELECT id INTO v_role_consultor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'consultor' LIMIT 1;

  -- Dono de Banca: Meu Anti-Spam visível
  IF v_role_dono IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_dono, v_item_meu_anti_spam, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;

  -- Gerente: Meu Anti-Spam visível
  IF v_role_gerente IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_gerente, v_item_meu_anti_spam, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;

  -- Consultor: Meu Anti-Spam visível
  IF v_role_consultor IS NOT NULL THEN
    INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
    VALUES (v_zaploto_id, v_role_consultor, v_item_meu_anti_spam, true)
    ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
  END IF;
END $$;
