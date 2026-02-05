-- =====================================================
-- Migration: Incluir status super_admin nas políticas de auditoria
-- Data: 2026-02-04
-- Descrição: SuperAdmin deve ter acesso às tabelas de auditoria (audit_group_names, group_participant_exits).
-- =====================================================

-- audit_group_names: recria política incluindo super_admin
DROP POLICY IF EXISTS "Auditoria e admin podem ler audit_group_names" ON audit_group_names;
CREATE POLICY "Auditoria e admin podem ler audit_group_names"
  ON audit_group_names
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin', 'dono_banca', 'gerente', 'auditoria')
    )
  );

-- group_participant_exits: recria política incluindo super_admin
DROP POLICY IF EXISTS "Auditoria e gestores podem ler group_participant_exits" ON group_participant_exits;
CREATE POLICY "Auditoria e gestores podem ler group_participant_exits"
  ON group_participant_exits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('super_admin', 'admin', 'dono_banca', 'gerente', 'auditoria')
    )
  );
