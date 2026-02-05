-- =====================================================
-- Migration: Criar tabela crm_lead_tags
-- Data: 2026-01-08
-- Descrição: Tabela de relacionamento entre leads e tags
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_lead_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_external_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(lead_external_id, user_id, tag_id)
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_lead_user ON crm_lead_tags(lead_external_id, user_id);
CREATE INDEX IF NOT EXISTS idx_crm_lead_tags_tag ON crm_lead_tags(tag_id);

-- Habilitar RLS
ALTER TABLE crm_lead_tags ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
-- Usuários podem ver tags de seus próprios leads
CREATE POLICY "Users can view own lead tags" 
ON crm_lead_tags 
FOR SELECT 
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.status = 'admin'
  )
);

-- Usuários podem gerenciar tags de seus próprios leads
CREATE POLICY "Users can manage own lead tags" 
ON crm_lead_tags 
FOR ALL 
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.status = 'admin'
  )
);

-- Comentários
COMMENT ON TABLE crm_lead_tags IS 'Tabela de relacionamento entre leads e etiquetas';
COMMENT ON COLUMN crm_lead_tags.lead_external_id IS 'ID do lead na API externa';
COMMENT ON COLUMN crm_lead_tags.user_id IS 'ID do consultor (profiles.id) dono do lead';

