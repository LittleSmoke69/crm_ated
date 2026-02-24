-- =====================================================
-- Migration: Garantir isolamento por tenant
-- Data: 2026-02-23
-- Depende: add_zaploto_id_to_profiles_and_tables.sql
-- Descrição: Adiciona zaploto_id em tabelas que precisam de isolamento.
-- Filtrar por profiles.zaploto_id ou crm_bancas.zaploto_id na aplicação.
-- =====================================================

-- evolution_instances: vincula ao tenant do user (via profiles)
-- Adicionar zaploto_id para consultas diretas sem JOIN
ALTER TABLE evolution_instances
ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_evolution_instances_zaploto ON evolution_instances(zaploto_id);

-- evolution_instances pode ter user_id (profiles.id) ou ser linked via evolution_api
-- Verificar estrutura: se tiver user_id, preencher zaploto_id do profile
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'evolution_instances' AND column_name = 'user_id') THEN
    UPDATE evolution_instances ei
    SET zaploto_id = COALESCE(p.zaploto_id, '00000000-0000-0000-0000-000000000001'::uuid)
    FROM profiles p
    WHERE ei.user_id::text = p.id::text AND ei.zaploto_id IS NULL;
  END IF;
END $$;

-- Fallback para tenant padrão onde profile.zaploto_id é null
UPDATE evolution_instances
SET zaploto_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE zaploto_id IS NULL;

-- campaigns: via user -> profile (opcional, pois filtramos por user_id in (...))
ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_campaigns_zaploto ON campaigns(zaploto_id);

-- campaigns.user_id pode ser TEXT (Evolution) ou UUID; cast explícito para evitar "operator does not exist: text = uuid"
UPDATE campaigns c
SET zaploto_id = COALESCE(p.zaploto_id, '00000000-0000-0000-0000-000000000001'::uuid)
FROM profiles p
WHERE c.user_id::text = p.id::text AND c.zaploto_id IS NULL;

UPDATE campaigns SET zaploto_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE zaploto_id IS NULL;

-- message_schedules: via user
ALTER TABLE message_schedules
ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_message_schedules_zaploto ON message_schedules(zaploto_id);

-- message_schedules.user_id pode variar; cast explícito para evitar incompatibilidade text = uuid
UPDATE message_schedules ms
SET zaploto_id = COALESCE(p.zaploto_id, '00000000-0000-0000-0000-000000000001'::uuid)
FROM profiles p
WHERE ms.user_id::text = p.id::text AND ms.zaploto_id IS NULL;

UPDATE message_schedules SET zaploto_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE zaploto_id IS NULL;

COMMENT ON COLUMN evolution_instances.zaploto_id IS 'Tenant da instância - isolamento white label';
COMMENT ON COLUMN campaigns.zaploto_id IS 'Tenant da campanha - isolamento white label';
COMMENT ON COLUMN message_schedules.zaploto_id IS 'Tenant do agendamento - isolamento white label';
