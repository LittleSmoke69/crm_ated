-- =====================================================
-- Migration: Criar tabela para Agentes IA
-- Data: 2024
-- Descrição: Armazena configurações de agentes IA que podem ser ativados pelos usuários
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  instructions text, -- Instruções/prompt para o agente IA
  enabled boolean NOT NULL DEFAULT false, -- Se o agente está ativo globalmente (admin controla)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text -- ID do admin que criou
);

-- Comentários
COMMENT ON TABLE ai_agents IS 'Agentes IA disponíveis no sistema - gerenciados pelo admin';
COMMENT ON COLUMN ai_agents.name IS 'Nome do agente IA (ex: "Assistente de Vendas")';
COMMENT ON COLUMN ai_agents.description IS 'Descrição do que o agente faz';
COMMENT ON COLUMN ai_agents.instructions IS 'Instruções/prompt do agente (será enviado para a IA)';
COMMENT ON COLUMN ai_agents.enabled IS 'Se o agente está ativo globalmente (admin controla)';
COMMENT ON COLUMN ai_agents.created_by IS 'ID do admin que criou o agente';

-- Tabela para configurações de usuários com agentes IA
CREATE TABLE IF NOT EXISTS user_ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ai_agent_id uuid NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES evolution_instances(id) ON DELETE SET NULL, -- Instância mestre selecionada
  group_jid text, -- JID do grupo onde o agente está ativo
  is_active boolean NOT NULL DEFAULT false, -- Se o usuário ativou este agente
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, ai_agent_id, group_jid) -- Um agente por usuário em cada grupo
);

-- Comentários
COMMENT ON TABLE user_ai_agents IS 'Configurações de agentes IA por usuário';
COMMENT ON COLUMN user_ai_agents.instance_id IS 'Instância mestre selecionada para rodar o agente';
COMMENT ON COLUMN user_ai_agents.group_jid IS 'JID do grupo onde o agente está ativo';
COMMENT ON COLUMN user_ai_agents.is_active IS 'Se o usuário ativou este agente';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_agents_enabled ON ai_agents(enabled);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_user_id ON user_ai_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_ai_agent_id ON user_ai_agents(ai_agent_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_instance_id ON user_ai_agents(instance_id);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_group_jid ON user_ai_agents(group_jid);
CREATE INDEX IF NOT EXISTS idx_user_ai_agents_active ON user_ai_agents(is_active) WHERE is_active = true;

