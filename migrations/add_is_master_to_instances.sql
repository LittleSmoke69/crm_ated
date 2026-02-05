-- =====================================================
-- Migration: Adicionar campo is_master na tabela evolution_instances
-- Data: 2024
-- Descrição: Adiciona campo is_master para diferenciar instâncias mestres (usadas para ativações e Agentes IA)
-- Instâncias mestres não recebem proxy automaticamente e cada usuário pode ter apenas uma
-- =====================================================

-- Adiciona coluna is_master (boolean, default false)
ALTER TABLE evolution_instances 
ADD COLUMN IF NOT EXISTS is_master BOOLEAN DEFAULT FALSE NOT NULL;

-- Comentário na coluna para documentação
COMMENT ON COLUMN evolution_instances.is_master IS 'Indica se a instância é mestre. Instâncias mestres são usadas para ativações e Agentes IA e não recebem proxy automaticamente. Cada usuário pode ter apenas uma instância mestre.';

-- Cria índice para facilitar consultas por is_master (opcional, mas útil para performance)
CREATE INDEX IF NOT EXISTS idx_evolution_instances_is_master 
ON evolution_instances(is_master) 
WHERE is_master = TRUE;

-- Cria índice composto para consultas por usuário e tipo de instância (útil para validar limite de uma instância mestre por usuário)
CREATE INDEX IF NOT EXISTS idx_evolution_instances_user_master 
ON evolution_instances(user_id, is_master) 
WHERE is_master = TRUE AND is_active = TRUE;

-- =====================================================
-- Validação: Verifica se a coluna foi criada
-- =====================================================
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'evolution_instances' AND column_name = 'is_master';

