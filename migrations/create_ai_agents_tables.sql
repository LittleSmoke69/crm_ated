-- =====================================================
-- Migration: Criar tabelas para Agentes IA
-- Data: 2024
-- Descrição: Sistema de Agentes IA que rodam baseados em eventos de webhook
-- =====================================================

-- =====================================================
-- Tabela: ai_agents
-- Armazena os Agentes IA disponíveis (criados pelo admin)
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  system_prompt text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE ai_agents IS 'Agentes IA disponíveis no sistema (criados pelo admin)';
COMMENT ON COLUMN ai_agents.name IS 'Nome do Agente IA';
COMMENT ON COLUMN ai_agents.description IS 'Descrição do que o agente faz';
COMMENT ON COLUMN ai_agents.system_prompt IS 'Prompt do sistema para o agente IA';
COMMENT ON COLUMN ai_agents.is_active IS 'Se o agente está ativo e disponível para uso';
COMMENT ON COLUMN ai_agents.created_by IS 'ID do admin que criou o agente';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_agents_is_active ON ai_agents(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ai_agents_created_at ON ai_agents(created_at DESC);

-- =====================================================
-- Tabela: user_ai_agents
-- Configurações de Agentes IA por usuário
-- =====================================================

CREATE TABLE IF NOT EXISTS user_ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ai_agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  group_jid text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, ai_agent_id, group_jid)
);

-- Comentários
COMMENT ON TABLE user_ai_agents IS 'Configurações de Agentes IA por usuário';
COMMENT ON COLUMN user_ai_agents.user_id IS 'ID do usuário que configurou o agente';
COMMENT ON COLUMN user_ai_agents.ai_agent_id IS 'ID do Agente IA';
COMMENT ON COLUMN user_ai_agents.instance_id IS 'ID da instância mestre que vai rodar o agente';
COMMENT ON COLUMN user_ai_agents.group_jid IS 'JID do grupo onde o agente está ativo';
COMMENT ON COLUMN user_ai_agents.is_active IS 'Se o agente está ativo para este usuário/grupo';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_user_id ON user_ai_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_ai_agent_id ON user_ai_agents(ai_agent_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_instance_id ON user_ai_agents(instance_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_group_jid ON user_ai_agents(group_jid);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_is_active ON user_ai_agents(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_active_group ON user_ai_agents(instance_id, group_jid, is_active) WHERE is_active = true;

