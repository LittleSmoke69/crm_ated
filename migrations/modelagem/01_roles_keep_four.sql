-- =====================================================
-- MODELAGEM 01 — ACESSO / ROLES
-- Objetivo: manter APENAS 4 cargos ativos (super_admin, admin, consultor, suporte)
--           e desativar os demais (auditoria, dono_banca, gestor, gerente).
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
  v_zaploto_id UUID;
  v_role_super    UUID;
  v_role_admin    UUID;
  v_role_consultor UUID;
  v_role_suporte  UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE NOTICE 'Tenant zaploto não encontrado — nada a fazer.';
    RETURN;
  END IF;

  -- 2) Garante que os 4 cargos mantidos existam e estejam ativos.
  INSERT INTO zaploto_roles (zaploto_id, code, label, description, sort_order, can_have_enroller, landing_route, is_system, is_active)
  VALUES
    (v_zaploto_id, 'super_admin', 'Super Admin', 'Acesso total',            0, false, '/admin',      true, true),
    (v_zaploto_id, 'admin',       'Admin',       'Painel administrativo',    1, false, '/admin',      true, true),
    (v_zaploto_id, 'suporte',     'Atendente',   'Atendimento e gestão de chat', 2, true, '/crm/kanban', true, true),
    (v_zaploto_id, 'consultor',   'Consultor',   'Operacional / CRM',        3, true, '/crm/kanban',  true, true)
  ON CONFLICT (zaploto_id, code) DO UPDATE
    SET is_active = true,
        is_system = true,
        updated_at = now();

  -- 3) Desativa os cargos que não fazem mais parte do modelo.
  UPDATE zaploto_roles
     SET is_active = false, updated_at = now()
   WHERE zaploto_id = v_zaploto_id
     AND code IN ('auditoria', 'dono_banca', 'gestor', 'gerente');

  SELECT id INTO v_role_super     FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'super_admin';
  SELECT id INTO v_role_admin     FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'admin';
  SELECT id INTO v_role_consultor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'consultor';
  SELECT id INTO v_role_suporte   FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'suporte';

  -- 4) Reafirma as permissões de sidebar dos 4 cargos (insert-select resiliente:
  --    só cria vínculo para itens que já existem no tenant; itens ausentes são ignorados).

  -- 4.1 Super Admin vê tudo.
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_super, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- 4.2 Admin: tudo menos itens de infraestrutura/atendimento operacional.
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_admin, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
    AND si.code NOT IN ('maturador', 'flows', 'gestao_banca', 'gestao_trafego', 'gestao_consultores')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- 4.3 Suporte: chat/atendimento + CRM + campanhas operacionais + perfil.
  --      Inclui possíveis codes de atendimento/gestão de chat caso já existam.
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_suporte, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
    AND si.code IN (
      'dashboard', 'chat', 'chat_atendimento', 'chat_gestao', 'chat_metricas',
      'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
      'contacts', 'campanhas', 'campanha_mensagem', 'campanha_grupos',
      'instances', 'profile'
    )
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- 4.4 Consultor: operacional / CRM.
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_consultor, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
    AND si.code IN (
      'meu_desempenho', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
      'campanha_consultor', 'campanha_consultor_msg', 'campanha_consultor_grupos',
      'instances', 'ai_agents', 'meu_anti_spam', 'profile'
    )
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- 5) Esconde da sidebar os itens exclusivos dos cargos aposentados,
  --    caso ainda estejam vinculados a algum cargo mantido por herança antiga.
  UPDATE zaploto_role_sidebar rs
     SET visible = false
    FROM zaploto_roles r
   WHERE rs.role_id = r.id
     AND r.zaploto_id = v_zaploto_id
     AND r.is_active = false;

  RAISE NOTICE 'Roles reduzidos a 4 (super_admin, admin, consultor, suporte).';
END $$;

-- =====================================================
-- OPCIONAL (revise antes de rodar): reatribuir usuários que ainda estão
-- em cargos aposentados. profiles.status é a fonte de verdade da autorização;
-- desativar o catálogo NÃO remove o acesso de quem já tem o status antigo.
--
-- Diagnóstico — quantos usuários seriam afetados:
--   SELECT status, count(*) FROM profiles
--    WHERE status IN ('auditoria','dono_banca','gestor','gerente')
--    GROUP BY status;
--
-- Reatribuição sugerida (descomente e ajuste o destino conforme sua operação):
--   UPDATE profiles SET status = 'admin'
--    WHERE status IN ('auditoria','dono_banca','gestor');
--   UPDATE profiles SET status = 'suporte'
--    WHERE status = 'gerente';
-- =====================================================
