-- =====================================================
-- Migration: Zaplink na sidebar para o role gerente
-- Data: 2026-03-03
-- Descrição: Garante que o gerente veja o item Zaplink na sidebar
--            (item já existe em zaploto_sidebar_items; apenas visibilidade para gerente).
-- O href para gerente é /gerente/zaplink (ajustado no backend por role).
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_role_gerente UUID;
  v_item_zaplink_id UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'Tenant zaploto não encontrado. Pulando migration add_zaplink_sidebar_gerente.';
    RETURN;
  END IF;

  SELECT id INTO v_role_gerente FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gerente' LIMIT 1;
  SELECT id INTO v_item_zaplink_id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'zaplink' LIMIT 1;

  IF v_role_gerente IS NULL OR v_item_zaplink_id IS NULL THEN
    RAISE NOTICE 'Role gerente ou item zaplink não encontrado. Pulando.';
    RETURN;
  END IF;

  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  VALUES (v_zaploto_id, v_role_gerente, v_item_zaplink_id, true)
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  RAISE NOTICE 'Zaplink adicionado à sidebar do role gerente.';
END $$;
