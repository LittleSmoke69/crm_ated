-- =====================================================
-- Migration: Criar tabela crm_tags
-- Data: 2026-01-08
-- Descrição: Tabela para gestão de etiquetas personalizadas do CRM
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#8CD955',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(label)
);

-- Habilitar RLS
ALTER TABLE crm_tags ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
-- Todos os usuários autenticados podem ler as tags (para filtro no Kanban)
CREATE POLICY "Authenticated users can read crm_tags" 
ON crm_tags 
FOR SELECT 
USING (true);

-- Apenas admins podem criar, atualizar ou deletar tags
CREATE POLICY "Admins can modify crm_tags" 
ON crm_tags 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.status = 'admin'
  )
);

-- Comentários
COMMENT ON TABLE crm_tags IS 'Tabela de etiquetas personalizadas para o CRM';
COMMENT ON COLUMN crm_tags.label IS 'Nome da etiqueta';
COMMENT ON COLUMN crm_tags.color IS 'Cor da etiqueta em formato hex (ex: #8CD955)';

