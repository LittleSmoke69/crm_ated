-- =====================================================
-- Adiciona "WhatsApp Oficial" à sidebar dinâmica (Integrações)
-- Depende: seed_zaploto_default_roles_and_sidebar.sql
-- Roda para todos os tenants que possuem o item 'integrations'.
-- =====================================================

DO $$
DECLARE
  v_tenant RECORD;
  v_role_super UUID;
  v_role_admin UUID;
  v_item_id UUID;
  v_item RECORD;
BEGIN
  -- Para cada tenant que tem o item "integrations" na sidebar
  FOR v_tenant IN
    SELECT DISTINCT zaploto_id FROM zaploto_sidebar_items WHERE code = 'integrations'
  LOOP
    -- Inserir item "WhatsApp Oficial" dentro de Integrações
    INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
    VALUES (v_tenant.zaploto_id, 'whatsapp_official', 'WhatsApp Oficial', '/admin/whatsapp-official', 'MessageSquare', 'integrations', 3)
    ON CONFLICT (zaploto_id, code) DO NOTHING;

    SELECT id INTO v_item_id FROM zaploto_sidebar_items
    WHERE zaploto_id = v_tenant.zaploto_id AND code = 'whatsapp_official' LIMIT 1;

    IF v_item_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_role_super FROM zaploto_roles WHERE zaploto_id = v_tenant.zaploto_id AND code = 'super_admin';
    SELECT id INTO v_role_admin FROM zaploto_roles WHERE zaploto_id = v_tenant.zaploto_id AND code = 'admin';

    -- Super Admin: garantir visibilidade do item WhatsApp Oficial + pai e irmãos (Integrações completo)
    IF v_role_super IS NOT NULL THEN
      FOR v_item IN
        SELECT id FROM zaploto_sidebar_items
        WHERE zaploto_id = v_tenant.zaploto_id
          AND (code = 'integrations' OR parent_code = 'integrations')
      LOOP
        INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
        VALUES (v_tenant.zaploto_id, v_role_super, v_item.id, true)
        ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
      END LOOP;
    END IF;

    -- Admin: ver Integrações + todos os filhos (incluindo WhatsApp Oficial)
    IF v_role_admin IS NOT NULL THEN
      FOR v_item IN
        SELECT id FROM zaploto_sidebar_items
        WHERE zaploto_id = v_tenant.zaploto_id
          AND (code = 'integrations' OR parent_code = 'integrations')
      LOOP
        INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
        VALUES (v_tenant.zaploto_id, v_role_admin, v_item.id, true)
        ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
      END LOOP;
    END IF;

  END LOOP;

END $$;
