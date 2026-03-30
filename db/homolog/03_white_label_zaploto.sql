-- Homolog: white label — tenants, roles, sidebar, admin steps (espelha migrations/create_zaploto_tenants_and_roles.sql)
-- Políticas recriáveis (DROP IF EXISTS) para homolog.

CREATE TABLE IF NOT EXISTS public.zaploto_tenants (
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

CREATE INDEX IF NOT EXISTS idx_zaploto_tenants_slug ON public.zaploto_tenants (slug);
CREATE INDEX IF NOT EXISTS idx_zaploto_tenants_domain ON public.zaploto_tenants (domain);

CREATE TABLE IF NOT EXISTS public.zaploto_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_zaploto_roles_zaploto ON public.zaploto_roles (zaploto_id);

CREATE TABLE IF NOT EXISTS public.zaploto_sidebar_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_zaploto_sidebar_items_zaploto ON public.zaploto_sidebar_items (zaploto_id);
CREATE INDEX IF NOT EXISTS idx_zaploto_sidebar_items_parent ON public.zaploto_sidebar_items (zaploto_id, parent_code);

CREATE TABLE IF NOT EXISTS public.zaploto_role_sidebar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.zaploto_roles (id) ON DELETE CASCADE,
  sidebar_item_id UUID NOT NULL REFERENCES public.zaploto_sidebar_items (id) ON DELETE CASCADE,
  visible BOOLEAN NOT NULL DEFAULT true,
  sort_override INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, sidebar_item_id)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_role_sidebar_role ON public.zaploto_role_sidebar (role_id);
CREATE INDEX IF NOT EXISTS idx_zaploto_role_sidebar_zaploto ON public.zaploto_role_sidebar (zaploto_id);

CREATE TABLE IF NOT EXISTS public.zaploto_admin_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  section_type TEXT NOT NULL CHECK (section_type IN ('tab', 'link')),
  route TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zaploto_id, code)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_admin_steps_zaploto ON public.zaploto_admin_steps (zaploto_id);

CREATE TABLE IF NOT EXISTS public.zaploto_role_admin_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.zaploto_roles (id) ON DELETE CASCADE,
  admin_step_id UUID NOT NULL REFERENCES public.zaploto_admin_steps (id) ON DELETE CASCADE,
  visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, admin_step_id)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_role_admin_steps_role ON public.zaploto_role_admin_steps (role_id);

ALTER TABLE public.zaploto_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zaploto_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zaploto_sidebar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zaploto_role_sidebar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zaploto_admin_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zaploto_role_admin_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "zaploto_tenants_no_anon" ON public.zaploto_tenants;
DROP POLICY IF EXISTS "zaploto_roles_no_anon" ON public.zaploto_roles;
DROP POLICY IF EXISTS "zaploto_sidebar_items_no_anon" ON public.zaploto_sidebar_items;
DROP POLICY IF EXISTS "zaploto_role_sidebar_no_anon" ON public.zaploto_role_sidebar;
DROP POLICY IF EXISTS "zaploto_admin_steps_no_anon" ON public.zaploto_admin_steps;
DROP POLICY IF EXISTS "zaploto_role_admin_steps_no_anon" ON public.zaploto_role_admin_steps;

CREATE POLICY "zaploto_tenants_no_anon" ON public.zaploto_tenants FOR ALL USING (false);
CREATE POLICY "zaploto_roles_no_anon" ON public.zaploto_roles FOR ALL USING (false);
CREATE POLICY "zaploto_sidebar_items_no_anon" ON public.zaploto_sidebar_items FOR ALL USING (false);
CREATE POLICY "zaploto_role_sidebar_no_anon" ON public.zaploto_role_sidebar FOR ALL USING (false);
CREATE POLICY "zaploto_admin_steps_no_anon" ON public.zaploto_admin_steps FOR ALL USING (false);
CREATE POLICY "zaploto_role_admin_steps_no_anon" ON public.zaploto_role_admin_steps FOR ALL USING (false);

COMMENT ON TABLE public.zaploto_tenants IS 'Instâncias white label — isolamento por tenant';
COMMENT ON TABLE public.zaploto_roles IS 'Cargos por tenant';
COMMENT ON TABLE public.zaploto_sidebar_items IS 'Itens do menu lateral por tenant';
COMMENT ON TABLE public.zaploto_role_sidebar IS 'Cargo → item de sidebar';
COMMENT ON TABLE public.zaploto_admin_steps IS 'Abas/steps do admin por tenant';
COMMENT ON TABLE public.zaploto_role_admin_steps IS 'Cargo → step do admin';
