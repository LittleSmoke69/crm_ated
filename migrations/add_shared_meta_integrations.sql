-- =====================================================
-- Migration: Integração Meta Ads compartilhada (1 integração -> N bancas)
-- Data: 2026-03-26
-- Descrição:
--  - Cria tabelas meta_integration_configs e meta_integration_bancas
--  - Migra dados existentes de meta_integrations (por banca) para o novo modelo
--  - NÃO remove meta_integrations (mantém para rollback/inspeção)
-- =====================================================

-- 1) Configuração (um registro por integração)
CREATE TABLE IF NOT EXISTS meta_integration_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_url TEXT NOT NULL DEFAULT 'https://graph.facebook.com/v19.0',
  access_token_encrypted TEXT,
  token_last4 TEXT,
  ad_account_id TEXT,
  pixel_id TEXT,
  default_campaign_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  currency TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  last_sync_date_preset TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_integration_configs_is_active ON meta_integration_configs(is_active);

-- 2) Vínculo banca <-> integração
CREATE TABLE IF NOT EXISTS meta_integration_bancas (
  integration_id UUID NOT NULL REFERENCES meta_integration_configs(id) ON DELETE CASCADE,
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (integration_id, banca_id),
  UNIQUE (banca_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_integration_bancas_banca_id ON meta_integration_bancas(banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_integration_bancas_integration_id ON meta_integration_bancas(integration_id);

-- 3) RLS: mesmo modelo do meta_integrations (apenas admin/super_admin)
ALTER TABLE meta_integration_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_integration_bancas ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Policies podem já existir (ambiente reaplicado)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage meta_integration_configs'
  ) THEN
    CREATE POLICY "Admins can manage meta_integration_configs"
      ON meta_integration_configs FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.status IN ('super_admin', 'admin')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage meta_integration_bancas'
  ) THEN
    CREATE POLICY "Admins can manage meta_integration_bancas"
      ON meta_integration_bancas FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.status IN ('super_admin', 'admin')
        )
      );
  END IF;
END $$;

-- 4) Migração dos dados existentes:
-- Para cada meta_integrations (por banca), cria uma config e vincula a banca.
-- Obs: aqui não tentamos "deduplicar" configs iguais; isso pode ser feito depois por ferramenta/admin.
--
-- currency foi introduzida em add_currency_to_meta_integrations.sql; ambientes antigos podem não tê-la.
ALTER TABLE meta_integrations ADD COLUMN IF NOT EXISTS currency TEXT;

WITH inserted AS (
  INSERT INTO meta_integration_configs (
    base_url,
    access_token_encrypted,
    token_last4,
    ad_account_id,
    pixel_id,
    default_campaign_id,
    is_active,
    currency,
    last_sync_at,
    last_sync_error,
    last_sync_date_preset,
    created_at,
    updated_at
  )
  SELECT
    mi.base_url,
    mi.access_token_encrypted,
    mi.token_last4,
    mi.ad_account_id,
    mi.pixel_id,
    mi.default_campaign_id,
    mi.is_active,
    mi.currency,
    mi.last_sync_at,
    mi.last_sync_error,
    mi.last_sync_date_preset,
    mi.created_at,
    mi.updated_at
  FROM meta_integrations mi
  WHERE NOT EXISTS (
    SELECT 1
    FROM meta_integration_bancas mib
    WHERE mib.banca_id = mi.banca_id
  )
  RETURNING id
),
to_link AS (
  SELECT
    mi.banca_id,
    mic.id AS integration_id
  FROM meta_integrations mi
  JOIN LATERAL (
    SELECT id
    FROM meta_integration_configs
    WHERE base_url = mi.base_url
      AND token_last4 IS NOT DISTINCT FROM mi.token_last4
      AND ad_account_id IS NOT DISTINCT FROM mi.ad_account_id
      AND pixel_id IS NOT DISTINCT FROM mi.pixel_id
      AND default_campaign_id IS NOT DISTINCT FROM mi.default_campaign_id
      AND is_active = mi.is_active
    ORDER BY created_at DESC
    LIMIT 1
  ) mic ON TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM meta_integration_bancas mib WHERE mib.banca_id = mi.banca_id
  )
)
INSERT INTO meta_integration_bancas (integration_id, banca_id)
SELECT integration_id, banca_id FROM to_link
ON CONFLICT (banca_id) DO NOTHING;

COMMENT ON TABLE meta_integration_configs IS 'Configuração da integração Meta Ads (compartilhada por várias bancas). Token criptografado.';
COMMENT ON TABLE meta_integration_bancas IS 'Vínculo entre bancas e integrações Meta Ads (uma banca aponta para uma integração).';

