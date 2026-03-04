-- =====================================================
-- Migration: Zaplink na sidebar para o role gestor (gestor de tráfego)
-- Data: 2026-03-04
-- Descrição: Garante que o gestor de tráfego veja o item Zaplink na sidebar.
--            O href para gestor é /gestor-trafego/zaplink (ajustado no backend por role).
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_role_gestor UUID;
  v_item_zaplink_id UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'Tenant zaploto não encontrado. Pulando migration add_zaplink_sidebar_gestor.';
    RETURN;
  END IF;

  SELECT id INTO v_role_gestor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gestor' LIMIT 1;
  SELECT id INTO v_item_zaplink_id FROM zaploto_sidebar_items WHERE zaploto_id = v_zaploto_id AND code = 'zaplink' LIMIT 1;

  IF v_role_gestor IS NULL OR v_item_zaplink_id IS NULL THEN
    RAISE NOTICE 'Role gestor ou item zaplink não encontrado. Pulando.';
    RETURN;
  END IF;

  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  VALUES (v_zaploto_id, v_role_gestor, v_item_zaplink_id, true)
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  RAISE NOTICE 'Zaplink adicionado à sidebar do role gestor (gestor de tráfego).';
END $$;
