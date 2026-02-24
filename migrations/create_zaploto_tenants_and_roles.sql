-- =====================================================
-- Migration: White Label + Cargos Dinâmicos
-- Data: 2026-02-23
-- Descrição: Tenants (Zaplotos white label), roles dinâmicos e permissões de visualização.
-- =====================================================

-- 1. ZAPLOTO TENANTS (white label - cada instância é um "Zaploto" isolado)
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

CREATE INDEX IF NOT EXISTS idx_zaploto_tenants_slug ON zaploto_tenants(slug);
CREATE INDEX IF NOT EXISTS idx_zaploto_tenants_domain ON zaploto_tenants(domain);

-- 2. ROLES (cargos - permite criar novos além dos padrões)
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
  UNIQUE(zaploto_id, code)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_roles_zaploto ON zaploto_roles(zaploto_id);

-- 3. SIDEBAR ITEMS (itens do menu - definidos por tenant)
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
  UNIQUE(zaploto_id, code)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_sidebar_items_zaploto ON zaploto_sidebar_items(zaploto_id);
CREATE INDEX IF NOT EXISTS idx_zaploto_sidebar_items_parent ON zaploto_sidebar_items(zaploto_id, parent_code);

-- 4. ROLE -> SIDEBAR (qual cargo vê qual item)
CREATE TABLE IF NOT EXISTS zaploto_role_sidebar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES zaploto_roles(id) ON DELETE CASCADE,
  sidebar_item_id UUID NOT NULL REFERENCES zaploto_sidebar_items(id) ON DELETE CASCADE,
  visible BOOLEAN NOT NULL DEFAULT true,
  sort_override INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role_id, sidebar_item_id)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_role_sidebar_role ON zaploto_role_sidebar(role_id);
CREATE INDEX IF NOT EXISTS idx_zaploto_role_sidebar_zaploto ON zaploto_role_sidebar(zaploto_id);

-- 5. ADMIN STEPS (steps do painel admin)
CREATE TABLE IF NOT EXISTS zaploto_admin_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  section_type TEXT NOT NULL CHECK (section_type IN ('tab', 'link')),
  route TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(zaploto_id, code)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_admin_steps_zaploto ON zaploto_admin_steps(zaploto_id);

-- 6. ROLE -> ADMIN STEPS (qual cargo vê qual step do admin)
CREATE TABLE IF NOT EXISTS zaploto_role_admin_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID NOT NULL REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES zaploto_roles(id) ON DELETE CASCADE,
  admin_step_id UUID NOT NULL REFERENCES zaploto_admin_steps(id) ON DELETE CASCADE,
  visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role_id, admin_step_id)
);

CREATE INDEX IF NOT EXISTS idx_zaploto_role_admin_steps_role ON zaploto_role_admin_steps(role_id);

-- RLS
ALTER TABLE zaploto_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaploto_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaploto_sidebar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaploto_role_sidebar ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaploto_admin_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaploto_role_admin_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zaploto_tenants_no_anon" ON zaploto_tenants FOR ALL USING (false);
CREATE POLICY "zaploto_roles_no_anon" ON zaploto_roles FOR ALL USING (false);
CREATE POLICY "zaploto_sidebar_items_no_anon" ON zaploto_sidebar_items FOR ALL USING (false);
CREATE POLICY "zaploto_role_sidebar_no_anon" ON zaploto_role_sidebar FOR ALL USING (false);
CREATE POLICY "zaploto_admin_steps_no_anon" ON zaploto_admin_steps FOR ALL USING (false);
CREATE POLICY "zaploto_role_admin_steps_no_anon" ON zaploto_role_admin_steps FOR ALL USING (false);

COMMENT ON TABLE zaploto_tenants IS 'Instâncias white label do Zaploto - dados isolados por tenant';
COMMENT ON TABLE zaploto_roles IS 'Cargos (roles) por tenant - permite criar cargos customizados';
COMMENT ON TABLE zaploto_sidebar_items IS 'Itens do menu lateral por tenant';
COMMENT ON TABLE zaploto_role_sidebar IS 'Permissão de visualização: qual cargo vê qual item da sidebar';
COMMENT ON TABLE zaploto_admin_steps IS 'Steps/abas do painel admin por tenant';
COMMENT ON TABLE zaploto_role_admin_steps IS 'Permissão: qual cargo vê qual step do admin';
