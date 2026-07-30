-- =====================================================
-- MODELAGEM 25 — Sidebar admin: E-mails + Integrações
-- (WhatsApp Oficial e Meta Ads)
-- Idempotente. Rode no SQL Editor do Supabase.
-- =====================================================

DO $$
DECLARE
  v_tenant UUID;
  v_role   RECORD;
  v_item   RECORD;
BEGIN
  SELECT id INTO v_tenant FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM zaploto_tenants ORDER BY created_at ASC NULLS LAST LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE NOTICE 'Nenhum tenant encontrado — sidebar admin não atualizada.';
    RETURN;
  END IF;

  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES
    (v_tenant, 'admin_emails',      'E-mails',          '/admin/emails',            'Mail',          NULL,            13),
    (v_tenant, 'integrations',      'Integrações',      NULL,                       'Webhook',       NULL,            14),
    (v_tenant, 'whatsapp_official', 'WhatsApp Oficial', '/admin/whatsapp-official',  'MessageSquare', 'integrations',  0),
    (v_tenant, 'meta_ads',          'Meta Ads',         '/admin/meta',              'BarChart3',     'integrations',  1)
  ON CONFLICT (zaploto_id, code) DO UPDATE
    SET label = EXCLUDED.label,
        href = EXCLUDED.href,
        icon_name = EXCLUDED.icon_name,
        parent_code = EXCLUDED.parent_code,
        sort_order = EXCLUDED.sort_order,
        is_active = true;

  -- Admin + super_admin veem E-mails, Integrações e filhos
  FOR v_role IN
    SELECT id FROM zaploto_roles
     WHERE zaploto_id = v_tenant
       AND is_active = true
       AND code IN ('super_admin', 'admin')
  LOOP
    FOR v_item IN
      SELECT id FROM zaploto_sidebar_items
       WHERE zaploto_id = v_tenant
         AND code IN ('admin_emails', 'integrations', 'whatsapp_official', 'meta_ads')
    LOOP
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      VALUES (v_tenant, v_role.id, v_item.id, true)
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END LOOP;
  END LOOP;
END $$;
