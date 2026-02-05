-- =====================================================
-- Migration: Criar tabela crm_leads
-- Data: 2024
-- Descrição: Tabela para persistir leads sincronizados da API externa do CRM
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    external_id BIGINT NOT NULL,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT,
    last_name TEXT,
    phone TEXT,
    email TEXT,
    status TEXT,
    temperature TEXT,
    total_depositado NUMERIC DEFAULT 0,
    total_apostado NUMERIC DEFAULT 0,
    total_ganho NUMERIC DEFAULT 0,
    total_depositos_count INTEGER DEFAULT 0,
    stars INTEGER DEFAULT 0,
    is_affiliate BOOLEAN DEFAULT FALSE,
    affiliate_name TEXT,
    user_level TEXT,
    last_interaction TIMESTAMP WITH TIME ZONE,
    last_deposit_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT crm_leads_external_id_user_id_key UNIQUE (external_id, user_id)
);

-- Habilita RLS
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;

-- Política: Service role tem acesso total
CREATE POLICY "Service role full access crm_leads"
  ON crm_leads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Política: Usuários podem ver apenas seus próprios leads
CREATE POLICY "Users can view own crm_leads"
  ON crm_leads
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Comentários para documentação
COMMENT ON TABLE crm_leads IS 'Armazena leads sincronizados da API externa do CRM para cada consultor';
COMMENT ON COLUMN crm_leads.external_id IS 'ID do lead na API externa do CRM';
COMMENT ON COLUMN crm_leads.user_id IS 'ID do consultor (profiles.id) que é dono deste lead';

