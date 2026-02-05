-- =====================================================
-- Migration: Sistema de Normalização Configurável
-- Data: 2024
-- Descrição: Sistema para mapear campos do payload para campos normalizados, facilitando automações e agentes IA
-- =====================================================

-- =====================================================
-- Tabela: webhook_normalization_rules
-- Armazena regras de normalização para diferentes tipos de eventos
-- =====================================================

CREATE TABLE IF NOT EXISTS webhook_normalization_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  event_type text NOT NULL, -- Tipo de evento (ex: 'group-participants.update', 'messages.upsert')
  priority integer NOT NULL DEFAULT 0, -- Prioridade (maior = aplicado primeiro)
  enabled boolean NOT NULL DEFAULT true,
  rule_config jsonb NOT NULL, -- Configuração da regra
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text -- ID do usuário que criou
);

-- Comentários
COMMENT ON TABLE webhook_normalization_rules IS 'Regras de normalização configuráveis para mapear campos do payload para campos normalizados';
COMMENT ON COLUMN webhook_normalization_rules.name IS 'Nome da regra (ex: "Normalizar action group-participants")';
COMMENT ON COLUMN webhook_normalization_rules.description IS 'Descrição do que a regra faz';
COMMENT ON COLUMN webhook_normalization_rules.event_type IS 'Tipo de evento que a regra aplica (ex: "group-participants.update")';
COMMENT ON COLUMN webhook_normalization_rules.priority IS 'Prioridade da regra (maior = aplicado primeiro, permite múltiplas regras por evento)';
COMMENT ON COLUMN webhook_normalization_rules.enabled IS 'Se a regra está ativa';
COMMENT ON COLUMN webhook_normalization_rules.rule_config IS 'Configuração da regra em JSON (mapeamentos, transformações, etc)';

-- Estrutura do rule_config:
-- {
--   "mappings": [
--     {
--       "target": "action", // Campo normalizado de saída
--       "source": "data.action", // Path no payload original (JSONPath)
--       "type": "direct" | "transform" | "calculated", // Tipo de mapeamento
--       "transform": "lowercase" | "uppercase" | "trim" | null, // Transformação opcional
--       "default": null, // Valor padrão se não encontrado
--       "calculated": {
--         "type": "state_compare" | "custom", // Tipo de cálculo
--         "state_table": "group_participants_state", // Tabela de estado (se state_compare)
--         "key_fields": ["group_id", "participant_id"], // Campos para identificar registro
--         "logic": "add_if_new | remove_if_gone | unknown" // Lógica para state_compare
--       }
--     },
--     {
--       "target": "phoneNumber",
--       "source": "data.participants[0].phoneNumber",
--       "type": "direct",
--       "transform": null
--     }
--   ]
-- }

-- Indexes
CREATE INDEX IF NOT EXISTS idx_webhook_normalization_rules_event_type 
ON webhook_normalization_rules(event_type);

CREATE INDEX IF NOT EXISTS idx_webhook_normalization_rules_enabled 
ON webhook_normalization_rules(enabled) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_webhook_normalization_rules_priority 
ON webhook_normalization_rules(event_type, priority DESC) WHERE enabled = true;

-- =====================================================
-- Tabela: group_participants_state
-- Armazena estado dos participantes por grupo (para calcular add/remove)
-- =====================================================

CREATE TABLE IF NOT EXISTS group_participants_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id text NOT NULL,
  participant_id text NOT NULL, -- phoneNumber ou JID
  phone_number text, -- Número de telefone normalizado
  is_active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  instance_name text, -- Instância que reportou
  UNIQUE(group_id, participant_id, instance_name)
);

-- Comentários
COMMENT ON TABLE group_participants_state IS 'Estado dos participantes por grupo - usado para calcular action add/remove';
COMMENT ON COLUMN group_participants_state.group_id IS 'ID do grupo (JID)';
COMMENT ON COLUMN group_participants_state.participant_id IS 'ID do participante (phoneNumber ou JID)';
COMMENT ON COLUMN group_participants_state.phone_number IS 'Número de telefone normalizado';
COMMENT ON COLUMN group_participants_state.is_active IS 'Se o participante está ativo no grupo';
COMMENT ON COLUMN group_participants_state.first_seen_at IS 'Primeira vez que o participante foi visto';
COMMENT ON COLUMN group_participants_state.last_seen_at IS 'Última vez que o participante foi visto';
COMMENT ON COLUMN group_participants_state.instance_name IS 'Instância que reportou o estado';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_group_participants_state_group_id 
ON group_participants_state(group_id);

CREATE INDEX IF NOT EXISTS idx_group_participants_state_participant_id 
ON group_participants_state(participant_id);

CREATE INDEX IF NOT EXISTS idx_group_participants_state_active 
ON group_participants_state(group_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_group_participants_state_instance 
ON group_participants_state(instance_name, group_id);

-- =====================================================
-- Adicionar coluna payload_normalized na tabela evolution_webhook_events
-- =====================================================

ALTER TABLE evolution_webhook_events 
ADD COLUMN IF NOT EXISTS payload_normalized jsonb;

COMMENT ON COLUMN evolution_webhook_events.payload_normalized IS 'Payload normalizado após aplicar regras de normalização';

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_normalized 
ON evolution_webhook_events(event_type) WHERE payload_normalized IS NOT NULL;

-- =====================================================
-- Nota: A função de normalização é implementada no backend (Node.js)
-- por ser mais complexa e requerer lógica de estado
-- Esta migration apenas cria as tabelas necessárias
-- =====================================================

-- =====================================================
-- Validação
-- =====================================================

-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('webhook_normalization_rules', 'group_participants_state');

