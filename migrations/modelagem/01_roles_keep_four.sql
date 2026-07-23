-- =====================================================
-- MODELAGEM 01 — ACESSO / ROLES
-- Objetivo: manter APENAS 4 cargos ativos:
--   super_admin > admin > gerente > captador
-- (captador substitui consultor; suporte foi aposentado — absorvido por admin
--  no remapeamento de usuários; não entra mais no catálogo ativo)
-- Depende: create_zaploto_tenants_and_roles.sql, seed_zaploto_default_roles_and_sidebar.sql
-- Idempotente: pode rodar mais de uma vez. NÃO recria o banco.
-- =====================================================

-- 1) Sinalizador de cargo ativo no catálogo de roles.
--    A aplicação deve passar a filtrar seletores de cargo por is_active = true.
ALTER TABLE zaploto_roles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN zaploto_roles.is_active IS
  'false = cargo aposentado; a UI não deve oferecê-lo em seletores nem no admin.';

DO $$
DECLARE
  v_tenant RECORD;
  v_role_super    UUID;
  v_role_admin    UUID;
  v_role_gerente  UUID;
  v_role_captador UUID;
BEGIN
  FOR v_tenant IN SELECT id FROM zaploto_tenants LOOP

    -- 2) Garante que os 4 cargos mantidos existam e estejam ativos.
    INSERT INTO zaploto_roles (zaploto_id, code, label, description, sort_order, can_have_enroller, landing_route, is_system, is_active)
    VALUES
      (v_tenant.id, 'super_admin', 'Super Admin', 'Acesso total',                        0, false, '/admin',     true, true),
      (v_tenant.id, 'admin',       'Admin',       'Painel administrativo',               1, false, '/admin',     true, true),
      (v_tenant.id, 'gerente',     'Gerente',     'Gestão de captadores',                2, true,  '/gerente',   true, true),
      (v_tenant.id, 'captador',    'Captador',    'Captação de leads / operacional CRM', 3, true,  '/consultor', true, true)
    ON CONFLICT (zaploto_id, code) DO UPDATE
      SET label = EXCLUDED.label,
          description = EXCLUDED.description,
          sort_order = EXCLUDED.sort_order,
          landing_route = EXCLUDED.landing_route,
          can_have_enroller = EXCLUDED.can_have_enroller,
          is_active = true,
          is_system = true,
          updated_at = now();

    -- 3) Desativa os cargos que não fazem mais parte do modelo.
    UPDATE zaploto_roles
       SET is_active = false, updated_at = now()
     WHERE zaploto_id = v_tenant.id
       AND code IN ('auditoria', 'dono_banca', 'gestor', 'suporte', 'consultor');

    SELECT id INTO v_role_super    FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'super_admin';
    SELECT id INTO v_role_admin    FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'admin';
    SELECT id INTO v_role_gerente  FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'gerente';
    SELECT id INTO v_role_captador FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'captador';

    -- 4) Reafirma as permissões de sidebar dos 4 cargos.

    -- 4.1 Super Admin vê tudo.
    IF v_role_super IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT v_tenant.id, v_role_super, si.id, true
      FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_tenant.id
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    -- 4.2 Admin: tudo menos itens de infraestrutura/atendimento operacional.
    IF v_role_admin IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT v_tenant.id, v_role_admin, si.id, true
      FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_tenant.id
        AND si.code NOT IN ('maturador', 'flows', 'gestao_banca', 'gestao_trafego', 'gestao_consultores')
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    -- 4.3 Gerente: gestão de captadores + operação (CRM, campanhas, chat, etc.).
    IF v_role_gerente IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT v_tenant.id, v_role_gerente, si.id, true
      FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_tenant.id
        AND si.code IN (
          'gestao_consultores', 'meu_desempenho', 'desempenho_detalhado',
          'lead_transfer', 'gerente_lead_stock', 'gestao_trafego', 'zaplink',
          'dashboard', 'instances', 'chat_atendimento', 'chat_gestao', 'ai_agents',
          'academy', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
          'campanhas', 'campanha_mensagem', 'campanha_grupos',
          'contacts', 'import_contacts', 'list_cleaning', 'meu_anti_spam', 'profile'
        )
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    -- 4.4 Captador: operacional / CRM.
    IF v_role_captador IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT v_tenant.id, v_role_captador, si.id, true
      FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_tenant.id
        AND si.code IN (
          'meu_desempenho', 'desempenho_detalhado', 'instances', 'chat_atendimento',
          'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
          'campanha_consultor', 'campanha_consultor_msg', 'campanha_consultor_grupos',
          'ai_agents', 'academy', 'meu_anti_spam', 'profile'
        )
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

    -- 5) Esconde da sidebar os itens exclusivos dos cargos aposentados.
    UPDATE zaploto_role_sidebar rs
       SET visible = false
      FROM zaploto_roles r
     WHERE rs.role_id = r.id
       AND r.zaploto_id = v_tenant.id
       AND r.is_active = false;

  END LOOP;

  RAISE NOTICE 'Roles reduzidos a 4 (super_admin, admin, gerente, captador).';
END $$;
