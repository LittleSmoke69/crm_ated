-- =====================================================
-- Migration: Criar tabela crm_bancas
-- Data: 2026-01-08
-- Descrição: Tabela para gestão centralizada de bancas para o CRM
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_bancas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE crm_bancas ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
-- Nota: Como o sistema usa supabaseServiceRole para operações administrativas,
-- as políticas de RLS são contornadas, mas é boa prática tê-las.

-- Todos os usuários autenticados podem ler as bancas (para filtro no Kanban)
CREATE POLICY "Authenticated users can read crm_bancas" 
ON crm_bancas 
FOR SELECT 
USING (true);

-- Apenas admins podem criar, atualizar ou deletar bancas
CREATE POLICY "Admins can modify crm_bancas" 
ON crm_bancas 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.status = 'admin'
  )
);

-- Comentários
COMMENT ON TABLE crm_bancas IS 'Tabela de bancas cadastradas para integração via API no CRM';
COMMENT ON COLUMN crm_bancas.name IS 'Nome amigável da banca';
COMMENT ON COLUMN crm_bancas.url IS 'URL base da API da banca (ex: https://dominio.com)';

