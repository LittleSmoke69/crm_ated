-- Instâncias Evolution de chat de atendimento gerenciadas pelo gerente,
-- com atribuição opcional a consultor (acesso às mensagens via APIs de chat).

CREATE TABLE IF NOT EXISTS atendimento_chat_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_instance_id UUID NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  gerente_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultor_user_id UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT atendimento_chat_assignments_instance_unique UNIQUE (evolution_instance_id)
);

CREATE INDEX IF NOT EXISTS idx_atendimento_chat_assignments_gerente
  ON atendimento_chat_assignments (gerente_user_id);

CREATE INDEX IF NOT EXISTS idx_atendimento_chat_assignments_consultor
  ON atendimento_chat_assignments (consultor_user_id)
  WHERE consultor_user_id IS NOT NULL;

COMMENT ON TABLE atendimento_chat_assignments IS 'Vínculo gerente → instância Evolution (chat) → consultor opcional para atendimento.';
