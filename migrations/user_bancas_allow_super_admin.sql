-- =====================================================
-- Migration: Permitir super_admin em user_bancas (RLS)
-- Data: 2026-02-04
-- Pré-requisito: create_user_bancas_table.sql já executada
-- =====================================================

-- Remove a policy antiga que só permitia consultor e gerente
DROP POLICY IF EXISTS "Consultor and Gerente can manage own user_bancas" ON user_bancas;

-- Nova policy: consultor, gerente e super_admin podem gerenciar suas próprias linhas
CREATE POLICY "Consultor Gerente SuperAdmin can manage own user_bancas"
  ON user_bancas FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('consultor', 'gerente', 'super_admin')
    )
  );
