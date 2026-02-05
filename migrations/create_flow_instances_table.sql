-- =====================================================
-- Migration: Tabela flow_instances
-- Data: 2024
-- Descrição: Associa flows a instâncias e grupos específicos
-- =====================================================

-- =====================================================
-- Tabela: flow_instances
-- Armazena instâncias de flows aplicadas a grupos específicos
-- =====================================================

CREATE TABLE IF NOT EXISTS flow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  instance_name text NOT NULL, -- Nome da instância Evolution
  group_jid text NOT NULL, -- JID do grupo onde o flow será aplicado
  is_active boolean NOT NULL DEFAULT true, -- Se a automação está ativa neste grupo
  settings_json jsonb DEFAULT '{}'::jsonb, -- Configurações específicas desta instância
  user_id text NOT NULL, -- owner/tenant
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text, -- ID do usuário que criou
  UNIQUE(flow_id, instance_name, group_jid) -- Uma automação só pode ser aplicada uma vez por grupo
);

-- Comentários
COMMENT ON TABLE flow_instances IS 'Instâncias de flows aplicadas a grupos específicos - permite que um mesmo flow seja usado em múltiplos grupos';
COMMENT ON COLUMN flow_instances.flow_id IS 'ID do flow (automação)';
COMMENT ON COLUMN flow_instances.instance_name IS 'Nome da instância Evolution que será usada';
COMMENT ON COLUMN flow_instances.group_jid IS 'JID do grupo onde a automação será aplicada';
COMMENT ON COLUMN flow_instances.is_active IS 'Se a automação está ativa neste grupo específico';
COMMENT ON COLUMN flow_instances.settings_json IS 'Configurações específicas desta instância (overrides)';
COMMENT ON COLUMN flow_instances.user_id IS 'ID do usuário/tentante proprietário';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_flow_instances_flow_id ON flow_instances(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_instances_instance_name ON flow_instances(instance_name);
CREATE INDEX IF NOT EXISTS idx_flow_instances_group_jid ON flow_instances(group_jid);
CREATE INDEX IF NOT EXISTS idx_flow_instances_active ON flow_instances(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_flow_instances_user_id ON flow_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_flow_instances_flow_active ON flow_instances(flow_id, is_active);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_flow_instances_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_flow_instances_updated_at
  BEFORE UPDATE ON flow_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_flow_instances_updated_at();

