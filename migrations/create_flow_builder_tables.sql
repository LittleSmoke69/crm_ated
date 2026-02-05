-- =====================================================
-- Migration: Sistema de Flow Builder (MVP)
-- Data: 2024
-- Descrição: Tabelas para automações estilo n8n - flows, nodes, edges e execuções
-- =====================================================

-- =====================================================
-- Tabela: flows
-- Armazena fluxos de automação
-- =====================================================

CREATE TABLE IF NOT EXISTS flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'automation' CHECK (type IN ('automation', 'template')),
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'draft')),
  graph_json jsonb NOT NULL DEFAULT '{"nodes": [], "edges": []}'::jsonb,
  settings_json jsonb DEFAULT '{}'::jsonb,
  user_id text NOT NULL, -- owner/tenant
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text -- ID do usuário que criou
);

-- Comentários
COMMENT ON TABLE flows IS 'Fluxos de automação estilo n8n - armazena grafo de nodes e edges';
COMMENT ON COLUMN flows.name IS 'Nome do fluxo';
COMMENT ON COLUMN flows.description IS 'Descrição do que o fluxo faz';
COMMENT ON COLUMN flows.type IS 'Tipo do fluxo: automation ou template';
COMMENT ON COLUMN flows.status IS 'Status: active, inactive, draft';
COMMENT ON COLUMN flows.graph_json IS 'Grafo do fluxo em formato JSON (nodes e edges)';
COMMENT ON COLUMN flows.settings_json IS 'Configurações adicionais do fluxo (timeout, retry, etc)';
COMMENT ON COLUMN flows.user_id IS 'ID do usuário/tentante proprietário';

-- Estrutura do graph_json:
-- {
--   "nodes": [
--     {
--       "id": "node-1",
--       "type": "webhookTrigger",
--       "position": { "x": 100, "y": 100 },
--       "data": {
--         "label": "Webhook Event",
--         "config": {
--           "event_type": "group-participants.update",
--           "filters": {
--             "instance": null,
--             "action": "add"
--           }
--         }
--       }
--     },
--     {
--       "id": "node-2",
--       "type": "switch",
--       "position": { "x": 300, "y": 100 },
--       "data": {
--         "label": "Switch",
--         "config": {
--           "rules": [
--             {
--               "condition": "{{$json.normalized.action}} equals 'add'",
--               "output": "add"
--             }
--           ]
--         }
--       }
--     },
--     {
--       "id": "node-3",
--       "type": "randomPicker",
--       "position": { "x": 500, "y": 50 },
--       "data": {
--         "label": "Random Picker",
--         "config": {
--           "messages": [
--             "Mensagem 1",
--             "Mensagem 2"
--           ]
--         }
--       }
--     },
--     {
--       "id": "node-4",
--       "type": "sendMessage",
--       "position": { "x": 700, "y": 100 },
--       "data": {
--         "label": "Send Message",
--         "config": {
--           "instance_name": "instance-1",
--           "group_jid": "{{$json.normalized.groupId}}",
--           "message": "{{$json.randomPicker.selected}}"
--         }
--       }
--     }
--   ],
--   "edges": [
--     { "id": "edge-1", "source": "node-1", "target": "node-2" },
--     { "id": "edge-2", "source": "node-2", "target": "node-3", "sourceHandle": "add" },
--     { "id": "edge-3", "source": "node-3", "target": "node-4" }
--   ]
-- }

-- Indexes
CREATE INDEX IF NOT EXISTS idx_flows_user_id ON flows(user_id);
CREATE INDEX IF NOT EXISTS idx_flows_status ON flows(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flows_type ON flows(type);
CREATE INDEX IF NOT EXISTS idx_flows_status_user ON flows(user_id, status);

-- =====================================================
-- Tabela: flow_executions
-- Armazena execuções de fluxos
-- =====================================================

CREATE TABLE IF NOT EXISTS flow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  trigger_event_id uuid REFERENCES evolution_webhook_events(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  error_message text,
  input_data jsonb, -- Dados de entrada (payload normalizado)
  output_data jsonb, -- Dados de saída final
  user_id text NOT NULL -- owner/tenant
);

-- Comentários
COMMENT ON TABLE flow_executions IS 'Execuções de fluxos - rastreia cada vez que um flow é executado';
COMMENT ON COLUMN flow_executions.trigger_event_id IS 'ID do evento webhook que disparou o flow';
COMMENT ON COLUMN flow_executions.status IS 'Status da execução: running, success, failed, cancelled';
COMMENT ON COLUMN flow_executions.input_data IS 'Dados de entrada (payload normalizado do evento)';
COMMENT ON COLUMN flow_executions.output_data IS 'Dados de saída final do flow';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_flow_executions_flow_id ON flow_executions(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_executions_status ON flow_executions(status);
CREATE INDEX IF NOT EXISTS idx_flow_executions_started_at ON flow_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_executions_trigger_event ON flow_executions(trigger_event_id);
CREATE INDEX IF NOT EXISTS idx_flow_executions_user_id ON flow_executions(user_id);

-- =====================================================
-- Tabela: flow_execution_steps
-- Armazena passos (nodes) de cada execução
-- =====================================================

CREATE TABLE IF NOT EXISTS flow_execution_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES flow_executions(id) ON DELETE CASCADE,
  node_id text NOT NULL, -- ID do node no grafo
  node_type text NOT NULL, -- Tipo do node (webhookTrigger, switch, randomPicker, sendMessage)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms integer, -- Duração em milissegundos
  input_json jsonb, -- Input do node
  output_json jsonb, -- Output do node
  error_message text,
  execution_order integer NOT NULL DEFAULT 0 -- Ordem de execução
);

-- Comentários
COMMENT ON TABLE flow_execution_steps IS 'Passos (nodes) executados em cada execução de flow';
COMMENT ON COLUMN flow_execution_steps.node_id IS 'ID do node no grafo (referência ao graph_json)';
COMMENT ON COLUMN flow_execution_steps.node_type IS 'Tipo do node (webhookTrigger, switch, randomPicker, sendMessage)';
COMMENT ON COLUMN flow_execution_steps.input_json IS 'Dados de entrada do node';
COMMENT ON COLUMN flow_execution_steps.output_json IS 'Dados de saída do node';
COMMENT ON COLUMN flow_execution_steps.execution_order IS 'Ordem de execução do node';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_flow_execution_steps_execution_id ON flow_execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_flow_execution_steps_status ON flow_execution_steps(status);
CREATE INDEX IF NOT EXISTS idx_flow_execution_steps_node_id ON flow_execution_steps(execution_id, node_id);

-- =====================================================
-- Validação
-- =====================================================

-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('flows', 'flow_executions', 'flow_execution_steps');

