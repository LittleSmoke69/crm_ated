-- =====================================================
-- Fundação: tabelas que o código espera mas não são criadas
-- pelas outras migrations do repositório (evolução legada).
-- Execute este arquivo ANTES do restante em migrations_order.txt.
-- Idempotente (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS onde aplicável).
-- =====================================================

-- ---------------------------------------------------------------------------
-- profiles — autenticação própria (sem depender de auth.users)
-- ---------------------------------------------------------------------------
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (lower(trim(email)));

COMMENT ON TABLE public.profiles IS 'Usuários da aplicação; FKs do sistema apontam para profiles.id';

-- ---------------------------------------------------------------------------
-- user_settings — criada pelo app no cadastro; não havia migration dedicada
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  max_leads_per_day INTEGER NOT NULL DEFAULT 100,
  max_instances INTEGER NOT NULL DEFAULT 20,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON public.user_settings (user_id);

-- ---------------------------------------------------------------------------
-- webhook_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- evolution_apis / evolution_instances — create_chat_tables e demais fazem ALTER
-- Coluna api_key: usada por create_chat_tables.sql (cópia para api_key_global)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evolution_apis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  api_key_global TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.evolution_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_api_id UUID NOT NULL REFERENCES public.evolution_apis (id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  phone_number TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'ok',
  daily_limit INTEGER,
  sent_today INTEGER NOT NULL DEFAULT 0,
  error_today INTEGER NOT NULL DEFAULT 0,
  rate_limit_count_today INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  apikey TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evolution_instances_api_id ON public.evolution_instances (evolution_api_id);
CREATE INDEX IF NOT EXISTS idx_evolution_instances_user_id ON public.evolution_instances (user_id);
CREATE INDEX IF NOT EXISTS idx_evolution_instances_name ON public.evolution_instances (instance_name);

CREATE TABLE IF NOT EXISTS public.user_evolution_apis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  evolution_api_id UUID NOT NULL REFERENCES public.evolution_apis (id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_evolution_apis_user_api_key UNIQUE (user_id, evolution_api_id)
);
