-- =====================================================
-- MODELAGEM 00 — PRÉ-REQUISITOS (torna a pasta modelagem auto-suficiente)
-- Garante, de forma idempotente, TODAS as tabelas e colunas que as funções,
-- views e FKs de 01–05 referenciam mas que são criadas fora desta pasta.
--
-- Em um banco que JÁ existe (produção) = NO-OP total (tudo com IF NOT EXISTS).
-- Em um ambiente NOVO = provisiona a base mínima para 01–05 rodarem,
-- INCLUSIVE a tabela `profiles`.
-- Rode ANTES de 01–05.
-- =====================================================

-- 0) profiles — identidade (autenticação própria, sem depender de auth.users).
--    Espelha migrations/0000_foundation_supabase_core.sql. No-op se já existir.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  full_name TEXT,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  status TEXT,
  enroller UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  banca_name TEXT,
  banca_url TEXT,
  telefone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_lower
  ON public.profiles (lower(trim(email)));

-- 1) Núcleo white-label / roles (usado por 01, 02, 03) ------------------------
CREATE TABLE IF NOT EXISTS zaploto_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  domain TEXT NULL,
  logo_url TEXT NULL,
  favicon_url TEXT NULL,
  primary_color TEXT NOT NULL DEFAULT '#8CD955',
  secondary_color TEXT NULL,
  app_title TEXT NULL DEFAULT 'ZapLoto',
  support_email TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zaploto_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  can_have_enroller BOOLEAN NOT NULL DEFAULT true,
  landing_route TEXT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zaploto_id, code)
);

CREATE TABLE IF NOT EXISTS zaploto_sidebar_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  href TEXT NULL,
  icon_name TEXT NULL,
  parent_code TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zaploto_id, code)
);

CREATE TABLE IF NOT EXISTS zaploto_role_sidebar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES zaploto_roles(id) ON DELETE CASCADE,
  sidebar_item_id UUID NOT NULL REFERENCES zaploto_sidebar_items(id) ON DELETE CASCADE,
  visible BOOLEAN NOT NULL DEFAULT true,
  sort_override INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, sidebar_item_id)
);

-- Tenant padrão (para o lookup por slug 'zaploto' em 01/02).
INSERT INTO zaploto_tenants (name, slug)
VALUES ('ZapLoto', 'zaploto')
ON CONFLICT (slug) DO NOTHING;

-- 2) CRM base (usado por 02 e pela view de ROI em 04) -------------------------
CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id BIGINT NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT,
  last_name TEXT,
  phone TEXT,
  email TEXT,
  status TEXT,
  temperature TEXT,
  total_depositado NUMERIC DEFAULT 0,
  total_apostado NUMERIC DEFAULT 0,
  total_ganho NUMERIC DEFAULT 0,
  total_depositos_count INTEGER DEFAULT 0,
  stars INTEGER DEFAULT 0,
  is_affiliate BOOLEAN DEFAULT FALSE,
  affiliate_name TEXT,
  user_level TEXT,
  last_interaction TIMESTAMPTZ,
  last_deposit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT crm_leads_external_id_user_id_key UNIQUE (external_id, user_id)
);

CREATE TABLE IF NOT EXISTS crm_bancas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3) WhatsApp Oficial + Chat base (usado por 03) -----------------------------
CREATE TABLE IF NOT EXISTS whatsapp_official_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'WhatsApp Oficial',
  is_active BOOLEAN DEFAULT true,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  graph_version TEXT NOT NULL DEFAULT 'v25.0',
  access_token TEXT NOT NULL,
  verify_token TEXT NOT NULL,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Stub dependency-light: instance_id sem FK (Evolution não é requisito da modelagem).
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  user_id UUID REFERENCES profiles(id),
  instance_id UUID,
  remote_jid TEXT NOT NULL,
  title TEXT,
  is_group BOOLEAN DEFAULT FALSE,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Colunas que 03 usa e que, no schema real, vêm de migrations posteriores.
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_official_configs(id) ON DELETE CASCADE;
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS attendance_status TEXT DEFAULT 'pendente';
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- 4) Meta Ads base (usado pela view de ROI em 04) ----------------------------
CREATE TABLE IF NOT EXISTS meta_insights_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id UUID NOT NULL REFERENCES crm_bancas(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  reach BIGINT DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  spend NUMERIC DEFAULT 0,
  cpm NUMERIC,
  cpc NUMERIC,
  ctr NUMERIC,
  leads BIGINT DEFAULT 0,
  raw_actions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (banca_id, date, campaign_id)
);

-- Nota: RLS/policies das tabelas acima pertencem às migrations canônicas.
-- Aqui garantimos apenas ESTRUTURA (tabelas/colunas) para as funções da modelagem rodarem.
