-- Homolog: perfis e configurações por usuário (cadastro próprio; auth.uid em RLS quando usar Supabase Auth)

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
