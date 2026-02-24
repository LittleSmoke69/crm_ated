-- =====================================================
-- Migration: Marcar Zaploto Central (white label)
-- Data: 2026-02-24
-- Descrição: Adiciona is_central em zaploto_tenants para permitir que apenas
--            o Zaploto Central envie dados (transferências, instâncias, usuários, etc.)
--            para os demais white labels.
-- =====================================================

ALTER TABLE zaploto_tenants
ADD COLUMN IF NOT EXISTS is_central BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_zaploto_tenants_is_central ON zaploto_tenants(is_central) WHERE is_central = true;

-- Tenant padrão (Zaploto Original) é o central
UPDATE zaploto_tenants
SET is_central = true
WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
   OR slug = 'zaploto';

COMMENT ON COLUMN zaploto_tenants.is_central IS 'Se true, este tenant é o Zaploto Central e pode enviar dados para os demais white labels';
