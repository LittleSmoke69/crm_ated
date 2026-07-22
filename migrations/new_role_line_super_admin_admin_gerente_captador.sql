-- =====================================================
-- NOVA LINHA DE CARGOS
-- Objetivo: reduzir o modelo de cargos para 4:
--   super_admin (Super Admin) > admin (Admin) > gerente (Gerente) > captador (Captador)
-- O cargo "captador" substitui o antigo "consultor" (mesmas telas e APIs).
-- Remapeamento de usuários existentes:
--   consultor  -> captador
--   dono_banca -> gerente
--   gestor / auditoria / suporte -> admin (enroller zerado; admin não tem superior)
-- Depende: create_zaploto_tenants_and_roles.sql, seed_zaploto_default_roles_and_sidebar.sql
-- Idempotente: pode rodar mais de uma vez.
-- =====================================================

-- 1) Sinalizador de cargo ativo no catálogo de roles (pode já existir).
ALTER TABLE zaploto_roles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN zaploto_roles.is_active IS
  'false = cargo aposentado; a UI não deve oferecê-lo em seletores nem no admin.';

DO $$
DECLARE
  v_tenant RECORD;
  v_role_super     UUID;
  v_role_admin     UUID;
  v_role_gerente   UUID;
  v_role_captador  UUID;
  v_role_consultor UUID;
BEGIN
  -- Aplica o catálogo de cargos em TODOS os tenants (white label incluído).
  FOR v_tenant IN SELECT id FROM zaploto_tenants LOOP

    -- 2) Garante os 4 cargos da nova linha, ativos.
    INSERT INTO zaploto_roles (zaploto_id, code, label, description, sort_order, can_have_enroller, landing_route, is_system, is_active)
    VALUES
      (v_tenant.id, 'super_admin', 'Super Admin', 'Acesso total',                          0, false, '/admin',     true, true),
      (v_tenant.id, 'admin',       'Admin',       'Painel administrativo',                 1, false, '/admin',     true, true),
      (v_tenant.id, 'gerente',     'Gerente',     'Gestão de captadores',                  2, true,  '/gerente',   true, true),
      (v_tenant.id, 'captador',    'Captador',    'Captação de leads / operacional CRM',   3, true,  '/consultor', true, true)
    ON CONFLICT (zaploto_id, code) DO UPDATE
      SET label = EXCLUDED.label,
          description = EXCLUDED.description,
          sort_order = EXCLUDED.sort_order,
          landing_route = EXCLUDED.landing_route,
          is_system = true,
          is_active = true,
          updated_at = now();

    -- 3) Desativa os cargos aposentados.
    UPDATE zaploto_roles
       SET is_active = false, updated_at = now()
     WHERE zaploto_id = v_tenant.id
       AND code IN ('consultor', 'dono_banca', 'gestor', 'auditoria', 'suporte');

    SELECT id INTO v_role_super     FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'super_admin';
    SELECT id INTO v_role_admin     FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'admin';
    SELECT id INTO v_role_gerente   FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'gerente';
    SELECT id INTO v_role_captador  FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'captador';
    SELECT id INTO v_role_consultor FROM zaploto_roles WHERE zaploto_id = v_tenant.id AND code = 'consultor';

    -- 4) Captador herda as permissões de sidebar do antigo consultor.
    IF v_role_consultor IS NOT NULL AND v_role_captador IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT rs.zaploto_id, v_role_captador, rs.sidebar_item_id, rs.visible
        FROM zaploto_role_sidebar rs
       WHERE rs.role_id = v_role_consultor
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = EXCLUDED.visible;

      -- Idem para steps do painel admin (se houver).
      INSERT INTO zaploto_role_admin_steps (zaploto_id, role_id, admin_step_id, visible)
      SELECT ras.zaploto_id, v_role_captador, ras.admin_step_id, ras.visible
        FROM zaploto_role_admin_steps ras
       WHERE ras.role_id = v_role_consultor
      ON CONFLICT (role_id, admin_step_id) DO UPDATE SET visible = EXCLUDED.visible;
    END IF;

    -- 5) Super Admin continua vendo tudo.
    IF v_role_super IS NOT NULL THEN
      INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
      SELECT v_tenant.id, v_role_super, si.id, true
        FROM zaploto_sidebar_items si
       WHERE si.zaploto_id = v_tenant.id
      ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;
    END IF;

  END LOOP;

  RAISE NOTICE 'Catálogo de cargos atualizado: super_admin, admin, gerente, captador.';
END $$;

-- =====================================================
-- 6) REMAPEAMENTO DE USUÁRIOS (profiles.status é a fonte de verdade da autorização)
-- =====================================================

-- Diagnóstico (informativo): SELECT status, count(*) FROM profiles GROUP BY status;

-- consultor -> captador (mantém enroller: gerente/admin/super_admin já são superiores válidos)
UPDATE profiles SET status = 'captador' WHERE status = 'consultor';

-- dono_banca -> gerente (mantém enroller para preservar a rede existente)
UPDATE profiles SET status = 'gerente' WHERE status = 'dono_banca';

-- gestor / auditoria / suporte -> admin (admin não pode ter superior; zera enroller)
UPDATE profiles
   SET status = 'admin', enroller = NULL
 WHERE status IN ('gestor', 'auditoria', 'suporte');

-- Saneamento: admin/super_admin nunca têm enroller.
UPDATE profiles SET enroller = NULL
 WHERE status IN ('admin', 'super_admin') AND enroller IS NOT NULL;

-- =====================================================
-- Observações:
-- * As policies RLS antigas que citam status aposentados ('dono_banca', 'gestor',
--   'auditoria', 'suporte', 'consultor') tornam-se inertes: o runtime da aplicação
--   usa service role (bypassa RLS) e nenhum usuário permanece nesses status.
-- * As rotas /dono-banca e /gestor-trafego ficam órfãs (nenhum usuário possui
--   mais esses cargos) — código mantido por ora, sem acesso.
-- =====================================================
