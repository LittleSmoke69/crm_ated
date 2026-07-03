-- =====================================================
-- MODELAGEM 09 — TABELAS FALTANTES: META ADS + WHATSAPP OFICIAL
-- Cria/completa as tabelas que o app de Meta Ads e do chat oficial referencia
-- e que não estão nas migrations 00–07. Idempotente.
-- Depende de: 00 (profiles, crm_bancas, whatsapp_official_configs, chat_conversations,
--             meta_insights_daily), 06 (user_bancas).
-- Complementa: 04 (meta_ads, meta_insights_ad_daily, crm_lead_ad_attribution).
-- =====================================================

-- ═════════════════════════ META ADS ═════════════════════════

-- 1) meta_integrations (legado por banca)
CREATE TABLE IF NOT EXISTS meta_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL DEFAULT 'https://graph.facebook.com/v19.0',
  access_token_encrypted TEXT,
  token_last4 TEXT,
  ad_account_id TEXT,
  pixel_id TEXT,
  default_campaign_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  currency TEXT,
  blocked_ad_account_ids TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  last_sync_date_preset TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_integrations_banca_id ON meta_integrations(banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_integrations_is_active ON meta_integrations(is_active);

ALTER TABLE meta_integrations
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS blocked_ad_account_ids TEXT;

-- 2) meta_campaigns
CREATE TABLE IF NOT EXISTS meta_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  name TEXT,
  objective TEXT,
  status TEXT,
  effective_status TEXT,
  daily_budget NUMERIC,
  lifetime_budget NUMERIC,
  start_time TIMESTAMPTZ,
  stop_time TIMESTAMPTZ,
  campaign_kind TEXT NOT NULL DEFAULT 'normal',
  currency_override TEXT,
  redirect_project_id UUID,
  ads_attribution_consultor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ads_attribution_consultor_ids UUID[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_banca_id ON meta_campaigns(banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_redirect_project
  ON meta_campaigns(redirect_project_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_ads_attribution_consultor
  ON meta_campaigns(ads_attribution_consultor_id)
  WHERE ads_attribution_consultor_id IS NOT NULL;

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS campaign_kind TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS currency_override TEXT,
  ADD COLUMN IF NOT EXISTS redirect_project_id UUID,
  ADD COLUMN IF NOT EXISTS ads_attribution_consultor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ads_attribution_consultor_ids UUID[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_campaigns_campaign_kind_check'
  ) THEN
    ALTER TABLE meta_campaigns ADD CONSTRAINT meta_campaigns_campaign_kind_check
      CHECK (campaign_kind IN ('normal', 'bolao'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_campaigns_currency_override_chk'
  ) THEN
    ALTER TABLE meta_campaigns ADD CONSTRAINT meta_campaigns_currency_override_chk
      CHECK (currency_override IS NULL OR currency_override IN ('BRL', 'USD'));
  END IF;
END $$;

-- 3) meta_adsets
CREATE TABLE IF NOT EXISTS meta_adsets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  adset_id TEXT NOT NULL,
  campaign_id TEXT,
  name TEXT,
  status TEXT,
  effective_status TEXT,
  daily_budget NUMERIC,
  lifetime_budget NUMERIC,
  billing_event TEXT,
  optimization_goal TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, adset_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_adsets_banca_id ON meta_adsets(banca_id);

-- 4) meta_insights_daily (base em 00; completa colunas extras)
ALTER TABLE meta_insights_daily
  ADD COLUMN IF NOT EXISTS raw_cost_per_action_type JSONB;

CREATE INDEX IF NOT EXISTS idx_meta_insights_daily_banca_date
  ON meta_insights_daily(banca_id, date DESC);

-- 5) Integração compartilhada (1 config → N bancas)
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
  blocked_ad_account_ids TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  last_sync_date_preset TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_integration_configs_is_active
  ON meta_integration_configs(is_active);

ALTER TABLE meta_integration_configs
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS blocked_ad_account_ids TEXT;

CREATE TABLE IF NOT EXISTS meta_integration_bancas (
  integration_id UUID NOT NULL REFERENCES meta_integration_configs(id) ON DELETE CASCADE,
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (integration_id, banca_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_integration_bancas_banca_id
  ON meta_integration_bancas(banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_integration_bancas_integration_id
  ON meta_integration_bancas(integration_id);

-- Remove UNIQUE incorreto em banca_id (uma banca pode ter várias integrações)
ALTER TABLE meta_integration_bancas DROP CONSTRAINT IF EXISTS meta_integration_bancas_banca_id_key;

-- 6) Consultores por campanha
CREATE TABLE IF NOT EXISTS meta_campaign_consultors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  consultor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  daily_spend_estimate NUMERIC(12,2),
  whatsapp_group_name TEXT,
  whatsapp_group_invite_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, campaign_id, consultor_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_consultors_banca_campaign
  ON meta_campaign_consultors(banca_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaign_consultors_consultor
  ON meta_campaign_consultors(consultor_id);

ALTER TABLE meta_campaign_consultors
  ADD COLUMN IF NOT EXISTS daily_spend_estimate NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS whatsapp_group_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_group_invite_url TEXT;

-- 7) Rodadas de investimento
CREATE TABLE IF NOT EXISTS meta_investment_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  consultor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  consultor_email TEXT NOT NULL,
  data_inicial DATE NOT NULL,
  data_final DATE NOT NULL,
  meta_gasto NUMERIC NOT NULL CHECK (meta_gasto > 0),
  label TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (data_final >= data_inicial)
);

CREATE INDEX IF NOT EXISTS idx_meta_investment_rounds_banca
  ON meta_investment_rounds(banca_id);
CREATE INDEX IF NOT EXISTS idx_meta_investment_rounds_consultor
  ON meta_investment_rounds(consultor_id, data_inicial DESC);

-- ═════════════════════════ WHATSAPP OFICIAL / CHAT ═════════════════════════

-- 8) whatsapp_official_configs (base em 00; índices, trigger e RLS)
CREATE INDEX IF NOT EXISTS idx_whatsapp_official_configs_zaploto
  ON whatsapp_official_configs(zaploto_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_official_configs_active
  ON whatsapp_official_configs(is_active) WHERE is_active = true;

CREATE OR REPLACE FUNCTION set_whatsapp_official_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_official_configs_updated_at ON whatsapp_official_configs;
CREATE TRIGGER whatsapp_official_configs_updated_at
  BEFORE UPDATE ON whatsapp_official_configs
  FOR EACH ROW EXECUTE FUNCTION set_whatsapp_official_configs_updated_at();

-- 9) chat_conversations — colunas e índices do canal oficial
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS profile_pic_url TEXT,
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

ALTER TABLE chat_conversations
  ALTER COLUMN instance_id DROP NOT NULL;

ALTER TABLE chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_instance_id_remote_jid_key;

-- conflict_key para upsert PostgREST (Evolution ou oficial)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_conversations' AND column_name = 'conflict_key'
  ) THEN
    ALTER TABLE chat_conversations
      ADD COLUMN conflict_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN instance_id IS NOT NULL THEN 'i-' || instance_id::text
          WHEN whatsapp_config_id IS NOT NULL THEN 'w-' || whatsapp_config_id::text
          ELSE NULL
        END
      ) STORED;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_conflict_key_remote_jid
  ON chat_conversations(conflict_key, remote_jid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_instance_remote
  ON chat_conversations(instance_id, remote_jid) WHERE instance_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_whatsapp_config_remote
  ON chat_conversations(whatsapp_config_id, remote_jid) WHERE whatsapp_config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_customer_message_at
  ON chat_conversations(last_customer_message_at DESC) WHERE whatsapp_config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_conversations_tags
  ON chat_conversations USING GIN(tags)
  WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;

-- 10) chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  user_id UUID REFERENCES profiles(id),
  instance_id UUID,
  whatsapp_config_id UUID REFERENCES whatsapp_official_configs(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('in', 'out')),
  from_me BOOLEAN DEFAULT FALSE,
  sender_jid TEXT,
  text TEXT,
  media_type TEXT,
  media_url TEXT,
  caption TEXT,
  status TEXT DEFAULT 'pending',
  timestamp BIGINT,
  provider TEXT NOT NULL DEFAULT 'evolution',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_official_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE;

ALTER TABLE chat_messages ALTER COLUMN instance_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'conversation_id'
  ) THEN
    ALTER TABLE chat_messages ALTER COLUMN conversation_id SET NOT NULL;
  END IF;
END $$;

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_instance_id_message_id_key;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_conversation_message
  ON chat_messages(conversation_id, message_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_message_id_provider
  ON chat_messages(message_id, provider) WHERE provider = 'whatsapp_official';
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

-- 11) webhook_events (fila bruta do POST /api/webhooks/whatsapp-official)
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'whatsapp_official',
  event_name TEXT NOT NULL DEFAULT 'whatsapp_official',
  raw_payload JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON webhook_events(source);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
  ON webhook_events(processed_at) WHERE processed_at IS NULL;

-- 12) Etiquetas e contatos do chat
CREATE TABLE IF NOT EXISTS chat_conversation_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversation_tags_unique_name
  ON chat_conversation_tags(
    COALESCE(zaploto_id, '00000000-0000-0000-0000-000000000000'::uuid),
    LOWER(TRIM(name))
  );
CREATE INDEX IF NOT EXISTS idx_chat_conversation_tags_zaploto
  ON chat_conversation_tags(zaploto_id) WHERE zaploto_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_conversation_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  name TEXT,
  horario TEXT,
  crm_sync_kind TEXT DEFAULT 'manual',
  crm_snapshot JSONB,
  is_pinned_manual BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_conversation_contacts
  ADD COLUMN IF NOT EXISTS crm_sync_kind TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS crm_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS is_pinned_manual BOOLEAN DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversation_contacts_user_telefone
  ON chat_conversation_contacts(user_id, telefone);
CREATE INDEX IF NOT EXISTS idx_chat_conversation_contacts_user_id
  ON chat_conversation_contacts(user_id);

-- 13) RPC usada pelo processador do webhook oficial
CREATE OR REPLACE FUNCTION increment_unread_count(conv_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE chat_conversations
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE id = conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_unread_count(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION increment_unread_count(UUID) TO authenticated;

-- ═════════════════════════ RLS ═════════════════════════

-- Meta: admin gerencia; gestor lê bancas atribuídas (user_bancas.banca_ids JSONB)
ALTER TABLE meta_integrations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_campaigns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_adsets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_insights_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_integration_configs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_integration_bancas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_campaign_consultors   ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_investment_rounds     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage meta_integrations" ON meta_integrations;
CREATE POLICY "Admins can manage meta_integrations" ON meta_integrations FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Admins can manage meta_campaigns" ON meta_campaigns;
CREATE POLICY "Admins can manage meta_campaigns" ON meta_campaigns FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Gestor can read meta_campaigns for assigned bancas" ON meta_campaigns;
CREATE POLICY "Gestor can read meta_campaigns for assigned bancas" ON meta_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
        AND ub.banca_ids @> jsonb_build_array(meta_campaigns.banca_id::text)
      WHERE p.id = auth.uid() AND p.status IN ('gestor','super_admin','admin')
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin'))
  );

DROP POLICY IF EXISTS "Admins can manage meta_adsets" ON meta_adsets;
CREATE POLICY "Admins can manage meta_adsets" ON meta_adsets FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Gestor can read meta_adsets for assigned bancas" ON meta_adsets;
CREATE POLICY "Gestor can read meta_adsets for assigned bancas" ON meta_adsets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
        AND ub.banca_ids @> jsonb_build_array(meta_adsets.banca_id::text)
      WHERE p.id = auth.uid() AND p.status IN ('gestor','super_admin','admin')
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin'))
  );

DROP POLICY IF EXISTS "Admins can manage meta_insights_daily" ON meta_insights_daily;
CREATE POLICY "Admins can manage meta_insights_daily" ON meta_insights_daily FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Gestor can read meta_insights_daily for assigned bancas" ON meta_insights_daily;
CREATE POLICY "Gestor can read meta_insights_daily for assigned bancas" ON meta_insights_daily FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
        AND ub.banca_ids @> jsonb_build_array(meta_insights_daily.banca_id::text)
      WHERE p.id = auth.uid() AND p.status IN ('gestor','super_admin','admin')
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin'))
  );

DROP POLICY IF EXISTS "Admins can manage meta_integration_configs" ON meta_integration_configs;
CREATE POLICY "Admins can manage meta_integration_configs" ON meta_integration_configs FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Admins can manage meta_integration_bancas" ON meta_integration_bancas;
CREATE POLICY "Admins can manage meta_integration_bancas" ON meta_integration_bancas FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Admins can manage meta_campaign_consultors" ON meta_campaign_consultors;
CREATE POLICY "Admins can manage meta_campaign_consultors" ON meta_campaign_consultors FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Gestor can read meta_campaign_consultors for assigned bancas" ON meta_campaign_consultors;
CREATE POLICY "Gestor can read meta_campaign_consultors for assigned bancas" ON meta_campaign_consultors FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
        AND ub.banca_ids @> jsonb_build_array(meta_campaign_consultors.banca_id::text)
      WHERE p.id = auth.uid() AND p.status IN ('gestor','super_admin','admin')
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin'))
  );

DROP POLICY IF EXISTS "Admins can manage meta_investment_rounds" ON meta_investment_rounds;
CREATE POLICY "Admins can manage meta_investment_rounds" ON meta_investment_rounds FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin')));

DROP POLICY IF EXISTS "Assigned users can read meta_investment_rounds" ON meta_investment_rounds;
CREATE POLICY "Assigned users can read meta_investment_rounds" ON meta_investment_rounds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN user_bancas ub ON ub.user_id = p.id
        AND ub.banca_ids @> jsonb_build_array(meta_investment_rounds.banca_id::text)
      WHERE p.id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status IN ('super_admin','admin'))
  );

-- WhatsApp oficial configs: só admin
ALTER TABLE whatsapp_official_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_official_configs_select_admin ON whatsapp_official_configs;
DROP POLICY IF EXISTS whatsapp_official_configs_insert_admin ON whatsapp_official_configs;
DROP POLICY IF EXISTS whatsapp_official_configs_update_admin ON whatsapp_official_configs;
DROP POLICY IF EXISTS whatsapp_official_configs_delete_admin ON whatsapp_official_configs;

CREATE POLICY whatsapp_official_configs_select_admin ON whatsapp_official_configs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin')));
CREATE POLICY whatsapp_official_configs_insert_admin ON whatsapp_official_configs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin')));
CREATE POLICY whatsapp_official_configs_update_admin ON whatsapp_official_configs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin')));
CREATE POLICY whatsapp_official_configs_delete_admin ON whatsapp_official_configs FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin')));

-- Chat auxiliar: suporte/admin
ALTER TABLE chat_messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversation_tags     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversation_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_messages_staff ON chat_messages;
CREATE POLICY chat_messages_staff ON chat_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin','suporte')));

DROP POLICY IF EXISTS webhook_events_staff ON webhook_events;
CREATE POLICY webhook_events_staff ON webhook_events FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin','suporte')));

DROP POLICY IF EXISTS chat_conversation_tags_staff ON chat_conversation_tags;
CREATE POLICY chat_conversation_tags_staff ON chat_conversation_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin','suporte')));

DROP POLICY IF EXISTS chat_conversation_contacts_owner ON chat_conversation_contacts;
CREATE POLICY chat_conversation_contacts_owner ON chat_conversation_contacts FOR ALL
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.status IN ('super_admin','admin','suporte'))
  );

-- Backend usa service_role no chat principal
ALTER TABLE chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;

-- ═════════════════════════ REALTIME ═════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'webhook_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE webhook_events;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
    END IF;
  END IF;
END $$;

ALTER TABLE chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE chat_messages REPLICA IDENTITY FULL;

-- ═════════════════════════ STORAGE (mídias do chat oficial) ═════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'chat-media', 'chat-media', true, 104857600,
      ARRAY['image/jpeg','image/png','image/webp','image/gif',
            'audio/ogg','audio/mpeg','audio/mp4',
            'video/mp4','video/3gpp','application/pdf']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
