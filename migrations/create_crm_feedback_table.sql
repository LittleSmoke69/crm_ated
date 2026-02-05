-- =====================================================
-- Migration: Criar tabela crm_feedback
-- Data: 2024
-- Descrição: Tabela para armazenar feedbacks de contato com clientes
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_user_id BIGINT NOT NULL, -- ID do cliente (lead) na API externa
    consultant_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE, -- ID do consultor que gravou o feedback
    feedback TEXT NOT NULL, -- Texto do feedback
    banca_url TEXT, -- URL da banca utilizada
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_crm_feedback_lead_user_id ON crm_feedback(lead_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_feedback_consultant_user_id ON crm_feedback(consultant_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_feedback_created_at ON crm_feedback(created_at DESC);

-- Habilita RLS
ALTER TABLE crm_feedback ENABLE ROW LEVEL SECURITY;

-- Política: Service role tem acesso total
CREATE POLICY "Service role full access crm_feedback"
  ON crm_feedback
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Política: Usuários podem ver apenas feedbacks que eles criaram ou de consultores que eles gerenciam
CREATE POLICY "Users can view own crm_feedback"
  ON crm_feedback
  FOR SELECT
  TO authenticated
  USING (auth.uid() = consultant_user_id);

-- Política: Usuários podem inserir apenas feedbacks com seu próprio ID
CREATE POLICY "Users can insert own crm_feedback"
  ON crm_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = consultant_user_id);

-- Comentários para documentação
COMMENT ON TABLE crm_feedback IS 'Armazena feedbacks de contato com clientes do CRM';
COMMENT ON COLUMN crm_feedback.lead_user_id IS 'ID do cliente (lead) na API externa do CRM';
COMMENT ON COLUMN crm_feedback.consultant_user_id IS 'ID do consultor (profiles.id) que gravou o feedback';
COMMENT ON COLUMN crm_feedback.feedback IS 'Texto do feedback sobre o contato realizado';
COMMENT ON COLUMN crm_feedback.banca_url IS 'URL da banca utilizada quando o feedback foi salvo';

