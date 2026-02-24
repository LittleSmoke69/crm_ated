-- =====================================================
-- Migration: Adicionar zaploto_id para isolamento de dados
-- Data: 2026-02-23
-- Depende: create_zaploto_tenants_and_roles.sql
-- Descrição: Vincula profiles e tabelas principais ao tenant (white label).
-- IMPORTANTE: Executar create_zaploto_tenants_and_roles.sql primeiro!
-- =====================================================

-- 1. Criar tenant padrão (Zaploto original) se não existir
INSERT INTO zaploto_tenants (id, name, slug, app_title, is_active)
SELECT 
  '00000000-0000-0000-0000-000000000001'::uuid,
  'ZapLoto Original',
  'zaploto',
  'ZapLoto',
  true
WHERE NOT EXISTS (SELECT 1 FROM zaploto_tenants WHERE slug = 'zaploto');

-- 2. Adicionar zaploto_id em profiles (nullable para retrocompatibilidade)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_zaploto ON profiles(zaploto_id);

-- Atualizar profiles existentes para o tenant padrão
UPDATE profiles SET zaploto_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE zaploto_id IS NULL;

-- 3. Adicionar zaploto_id em crm_bancas
ALTER TABLE crm_bancas
ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_crm_bancas_zaploto ON crm_bancas(zaploto_id);

UPDATE crm_bancas SET zaploto_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE zaploto_id IS NULL;

-- 4. Tabelas que precisam de zaploto_id (por user_id ou banca_id, a filtragem será feita via profiles/bancas)
-- evolution_instances - scoped por user -> profile.zaploto_id
-- campaigns - scoped por user
-- message_schedules - scoped por user
-- flows - global do sistema, podem ser por tenant no futuro
-- meta_integrations - scoped por banca -> crm_bancas.zaploto_id

-- Por enquanto, crm_bancas e profiles têm zaploto_id. Outras tabelas serão filtradas via JOIN.

COMMENT ON COLUMN profiles.zaploto_id IS 'Tenant (white label) do usuário - dados isolados por Zaploto';
COMMENT ON COLUMN crm_bancas.zaploto_id IS 'Tenant da banca - isolamento de dados por white label';
