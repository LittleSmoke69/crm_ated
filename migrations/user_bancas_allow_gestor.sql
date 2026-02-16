-- =====================================================
-- Migration: Permitir gestor em user_bancas (RLS)
-- Pré-requisito: user_bancas_allow_super_admin.sql já executada
-- Descrição: Gestor pode estar atribuído a várias bancas (user_bancas) e deve poder ler/gerenciar suas linhas.
-- =====================================================

DROP POLICY IF EXISTS "Consultor Gerente SuperAdmin can manage own user_bancas" ON user_bancas;

CREATE POLICY "Consultor Gerente Gestor SuperAdmin can manage own user_bancas"
  ON user_bancas FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('consultor', 'gerente', 'super_admin', 'gestor')
    )
  );

COMMENT ON TABLE user_bancas IS 'Bancas em que o usuário (consultor, gerente ou gestor) atua; gestor pode estar em várias bancas';
