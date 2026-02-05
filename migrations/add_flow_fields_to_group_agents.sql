-- =====================================================
-- Migration: Adicionar campos de flow na tabela whatsapp_group_agents
-- Data: 2024
-- Descrição: Adiciona flow_id, node_id e system_prompt para vincular agentes a flows
-- =====================================================

-- Remove constraint UNIQUE do group_jid (agora pode haver múltiplos agentes por grupo)
ALTER TABLE public.whatsapp_group_agents
DROP CONSTRAINT IF EXISTS whatsapp_group_agents_group_jid_key;

-- Torna group_jid nullable (será preenchido quando usuário configurar)
ALTER TABLE public.whatsapp_group_agents
ALTER COLUMN group_jid DROP NOT NULL;

-- Adiciona campos de flow
ALTER TABLE public.whatsapp_group_agents
ADD COLUMN IF NOT EXISTS flow_id uuid REFERENCES flows(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS node_id text NULL,
ADD COLUMN IF NOT EXISTS system_prompt text NULL,
ADD COLUMN IF NOT EXISTS instance_id uuid REFERENCES evolution_instances(id) ON DELETE SET NULL;

-- Comentários
COMMENT ON COLUMN public.whatsapp_group_agents.flow_id IS 'ID do flow que contém o node Agent IA';
COMMENT ON COLUMN public.whatsapp_group_agents.node_id IS 'ID do node Agent IA no flow';
COMMENT ON COLUMN public.whatsapp_group_agents.system_prompt IS 'Prompt do sistema do agente (vem do node)';
COMMENT ON COLUMN public.whatsapp_group_agents.instance_id IS 'ID da instância mestre configurada pelo usuário';
COMMENT ON COLUMN public.whatsapp_group_agents.group_jid IS 'JID do grupo WhatsApp (preenchido quando usuário configura)';

-- Cria constraint UNIQUE para (flow_id, node_id) - um agente por node
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_group_agents_flow_node 
ON public.whatsapp_group_agents(flow_id, node_id) 
WHERE flow_id IS NOT NULL AND node_id IS NOT NULL;

-- Cria índice para busca por flow
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_agents_flow 
ON public.whatsapp_group_agents(flow_id) 
WHERE flow_id IS NOT NULL;

-- Cria índice para busca por instância
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_agents_instance 
ON public.whatsapp_group_agents(instance_id) 
WHERE instance_id IS NOT NULL;

