-- =====================================================
-- Migration: Sistema de Providers LLM (Gemini e outros)
-- Data: 2024
-- Descrição: Tabela para gerenciar providers LLM (API Keys criptografadas)
-- =====================================================

CREATE TABLE IF NOT EXISTS llm_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL, -- user_id (para multi-tenant)
  provider text NOT NULL CHECK (provider IN ('gemini', 'openai', 'anthropic')), -- Provider LLM
  api_key_encrypted text NOT NULL, -- API Key criptografada (nunca texto puro)
  model_default text, -- Modelo padrão (ex: 'gemini-pro', 'gpt-4')
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text, -- ID do usuário que criou
  UNIQUE(tenant_id, provider) -- Um provider por tenant
);

-- Comentários
COMMENT ON TABLE llm_providers IS 'Providers LLM configuráveis por tenant - API Keys criptografadas';
COMMENT ON COLUMN llm_providers.tenant_id IS 'ID do tenant (user_id)';
COMMENT ON COLUMN llm_providers.provider IS 'Provider LLM: gemini, openai, anthropic';
COMMENT ON COLUMN llm_providers.api_key_encrypted IS 'API Key criptografada (nunca texto puro)';
COMMENT ON COLUMN llm_providers.model_default IS 'Modelo padrão do provider';
COMMENT ON COLUMN llm_providers.enabled IS 'Se o provider está habilitado';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_llm_providers_tenant_id ON llm_providers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_llm_providers_provider ON llm_providers(provider);
CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled ON llm_providers(tenant_id, enabled) WHERE enabled = true;

-- =====================================================
-- Adicionar campos ao ai_agents para personas/tons
-- =====================================================

ALTER TABLE ai_agents 
ADD COLUMN IF NOT EXISTS tone text CHECK (tone IN ('amigavel', 'neutro', 'profissional', 'agradavel', 'technical'));

ALTER TABLE ai_agents 
ADD COLUMN IF NOT EXISTS persona text; -- Camada de persona adicional (opcional)

ALTER TABLE ai_agents 
ADD COLUMN IF NOT EXISTS prompt_template text; -- Template do prompt (com placeholders)

COMMENT ON COLUMN ai_agents.tone IS 'Tom/persona do agente: amigavel, neutro, profissional, agradavel, technical';
COMMENT ON COLUMN ai_agents.persona IS 'Camada de persona adicional (opcional)';
COMMENT ON COLUMN ai_agents.prompt_template IS 'Template do prompt final (com placeholders para contexto)';

