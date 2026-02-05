-- =====================================================
-- Migration: Inserir tags padrão do CRM
-- Data: 2026-01-XX
-- Descrição: Insere as tags padrão utilizadas no sistema CRM
-- =====================================================

-- Insere todas as tags com cores específicas
-- Usa ON CONFLICT DO NOTHING para evitar duplicatas caso execute novamente

INSERT INTO crm_tags (label, color) VALUES
  ('AGUARDANDO RETORNO', '#F59E0B'),      -- Amarelo/Laranja - aguardando ação
  ('APOSTADOR ALTO', '#10B981'),          -- Verde - alto valor
  ('BAIXOU APP', '#8CD955'),              -- Verde claro - ação positiva
  ('CONTACTADO', '#3B82F6'),              -- Azul - comunicação
  ('CONTACTADO 2X', '#3B82F6'),           -- Azul - comunicação
  ('CONTACTADO 3X', '#3B82F6'),           -- Azul - comunicação
  ('CONTACTADO 4X', '#3B82F6'),           -- Azul - comunicação
  ('CONTACTADO 5X', '#3B82F6'),           -- Azul - comunicação
  ('Domingo', '#A855F7'),                 -- Roxo - dia da semana
  ('DÚVIDAS', '#F97316'),                 -- Laranja - atenção necessária
  ('ESPECIAL', '#FBBF24'),                -- Dourado - premium
  ('GRUPO VIP', '#9333EA'),               -- Roxo escuro - VIP
  ('NÃO BAIXOU O APP', '#EF4444'),        -- Vermelho - ação negativa
  ('NÃO RESPONDEU', '#F97316'),           -- Laranja/Vermelho - sem resposta
  ('Urgente', '#DC2626')                  -- Vermelho escuro - urgente
ON CONFLICT (label) DO NOTHING;

-- Verifica se todas as tags foram inseridas
SELECT 
  label, 
  color, 
  created_at 
FROM crm_tags 
WHERE label IN (
  'AGUARDANDO RETORNO',
  'APOSTADOR ALTO',
  'BAIXOU APP',
  'CONTACTADO',
  'CONTACTADO 2X',
  'CONTACTADO 3X',
  'CONTACTADO 4X',
  'CONTACTADO 5X',
  'Domingo',
  'DÚVIDAS',
  'ESPECIAL',
  'GRUPO VIP',
  'NÃO BAIXOU O APP',
  'NÃO RESPONDEU',
  'Urgente'
)
ORDER BY label;

