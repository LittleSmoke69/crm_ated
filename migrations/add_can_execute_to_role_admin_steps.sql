-- =====================================================
-- Migration: Permissão granular nos admin steps (view vs execute)
-- Data: 2026-02-23
-- Depende: create_zaploto_tenants_and_roles.sql, seed_zaploto_default_roles_and_sidebar.sql
-- Descrição: Adiciona can_execute em zaploto_role_admin_steps.
-- visible=true, can_execute=false → pode ver aba/link mas não executar ações sensíveis
-- Ex: Transferência de Leads - auditoria vê histórico mas não pode transferir
-- Ex: Configurações - admin vê mas não pode alterar APIs Evolution
-- =====================================================

ALTER TABLE zaploto_role_admin_steps
ADD COLUMN IF NOT EXISTS can_execute BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN zaploto_role_admin_steps.can_execute IS 'Se false: usuário pode ver o step mas não executar ações (ex: transferir leads, editar Evolution API)';

-- Atualizar permissões para tenant zaploto (padrão)
-- Auditoria: lead_transfer view-only (ver histórico, não transferir)
DO $$
DECLARE
  v_zaploto_id UUID;
  v_auditoria_role_id UUID;
  v_lead_transfer_step_id UUID;
  v_admin_role_id UUID;
  v_settings_step_id UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN RETURN; END IF;

  -- Auditoria + lead_transfer: visible=true, can_execute=false
  SELECT id INTO v_auditoria_role_id FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'auditoria' LIMIT 1;
  SELECT id INTO v_lead_transfer_step_id FROM zaploto_admin_steps WHERE zaploto_id = v_zaploto_id AND code = 'lead_transfer' LIMIT 1;
  IF v_auditoria_role_id IS NOT NULL AND v_lead_transfer_step_id IS NOT NULL THEN
    INSERT INTO zaploto_role_admin_steps (zaploto_id, role_id, admin_step_id, visible, can_execute)
    VALUES (v_zaploto_id, v_auditoria_role_id, v_lead_transfer_step_id, true, false)
    ON CONFLICT (role_id, admin_step_id) DO UPDATE SET visible = true, can_execute = false;
  END IF;

  -- Admin + settings: visible=true, can_execute=false (vê Configurações mas não altera APIs Evolution)
  SELECT id INTO v_admin_role_id FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'admin' LIMIT 1;
  SELECT id INTO v_settings_step_id FROM zaploto_admin_steps WHERE zaploto_id = v_zaploto_id AND code = 'settings' LIMIT 1;
  IF v_admin_role_id IS NOT NULL AND v_settings_step_id IS NOT NULL THEN
    INSERT INTO zaploto_role_admin_steps (zaploto_id, role_id, admin_step_id, visible, can_execute)
    VALUES (v_zaploto_id, v_admin_role_id, v_settings_step_id, true, false)
    ON CONFLICT (role_id, admin_step_id) DO UPDATE SET visible = true, can_execute = false;
  END IF;
END $$;
