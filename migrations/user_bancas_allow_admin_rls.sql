-- =====================================================
-- Migration: Permitir admin em user_bancas (RLS)
-- Descrição: Admin pode ler/gerenciar a própria linha em user_bancas (escopo por banca),
--            alinhado a consultor, gerente, gestor e super_admin.
-- =====================================================

DROP POLICY IF EXISTS "Consultor Gerente Gestor SuperAdmin can manage own user_bancas" ON user_bancas;

CREATE POLICY "Consultor Gerente Gestor SuperAdmin Admin can manage own user_bancas"
  ON user_bancas FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('consultor', 'gerente', 'super_admin', 'gestor', 'admin')
    )
  );

COMMENT ON TABLE user_bancas IS 'Bancas em que o usuário (consultor, gerente, gestor ou admin) atua; banca_ids é array de UUIDs';
