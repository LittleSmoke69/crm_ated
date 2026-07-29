-- Modelagem 23 — Stack mínima Evolution (APIs, instâncias, vínculo usuário)
-- Idempotente. Rode no SQL Editor do Supabase (self-hosted).

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

ALTER TABLE public.evolution_apis
  ADD COLUMN IF NOT EXISTS is_blocked_for_instances BOOLEAN NOT NULL DEFAULT false;

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

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS webhook_configured BOOLEAN DEFAULT false;

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS is_chat_instance BOOLEAN DEFAULT false;

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS blocked_from_maturation BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE;

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS maturation_type TEXT NOT NULL DEFAULT 'maturado';

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS proxy_id UUID;

CREATE INDEX IF NOT EXISTS idx_evolution_instances_zaploto
  ON public.evolution_instances (zaploto_id);

CREATE INDEX IF NOT EXISTS idx_evolution_instances_is_master
  ON public.evolution_instances (is_master)
  WHERE is_master = true;

CREATE INDEX IF NOT EXISTS idx_evolution_instances_api_id
  ON public.evolution_instances (evolution_api_id);

CREATE INDEX IF NOT EXISTS idx_evolution_instances_user_id
  ON public.evolution_instances (user_id);

CREATE INDEX IF NOT EXISTS idx_evolution_instances_name
  ON public.evolution_instances (instance_name);

CREATE TABLE IF NOT EXISTS public.user_evolution_apis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  evolution_api_id UUID NOT NULL REFERENCES public.evolution_apis (id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_evolution_apis_user_api_key UNIQUE (user_id, evolution_api_id)
);
