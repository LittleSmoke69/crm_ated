-- =====================================================
-- Migration: Academy (Área de Aprendizado)
-- Descrição: Tabelas para módulos, aulas, assets, anexos, progresso e snapshots VTurb
-- =====================================================

-- 2.1 academy_modules
CREATE TABLE IF NOT EXISTS academy_modules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  order_index INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  thumbnail_url TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academy_modules_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_academy_modules_slug ON academy_modules(slug);
CREATE INDEX IF NOT EXISTS idx_academy_modules_order ON academy_modules(order_index);
CREATE INDEX IF NOT EXISTS idx_academy_modules_published ON academy_modules(is_published) WHERE is_published = true;

-- 2.2 academy_lessons
CREATE TABLE IF NOT EXISTS academy_lessons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  module_id UUID NOT NULL REFERENCES academy_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  order_index INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  content_type TEXT NOT NULL CHECK (content_type IN ('vturb', 'iframe', 'text')),
  estimated_minutes INT,
  vturb_player_id TEXT,
  vturb_project_id TEXT,
  vturb_aspect_ratio NUMERIC,
  vturb_use_sdk BOOLEAN NOT NULL DEFAULT true,
  iframe_html TEXT,
  cta_label TEXT,
  cta_type TEXT CHECK (cta_type IN ('internal', 'external')),
  cta_url TEXT,
  cta_target TEXT NOT NULL DEFAULT '_self' CHECK (cta_target IN ('_self', '_blank')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academy_lessons_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_academy_lessons_module ON academy_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_academy_lessons_slug ON academy_lessons(slug);
CREATE INDEX IF NOT EXISTS idx_academy_lessons_order ON academy_lessons(module_id, order_index);
CREATE INDEX IF NOT EXISTS idx_academy_lessons_published ON academy_lessons(is_published) WHERE is_published = true;

-- 2.3 academy_assets
CREATE TABLE IF NOT EXISTS academy_assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('image', 'table', 'pdf', 'doc', 'docx', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  public_url TEXT,
  category TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_assets_type ON academy_assets(type);
CREATE INDEX IF NOT EXISTS idx_academy_assets_published ON academy_assets(is_published) WHERE is_published = true;

-- 2.4 academy_lesson_attachments
CREATE TABLE IF NOT EXISTS academy_lesson_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES academy_assets(id) ON DELETE CASCADE,
  label TEXT,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academy_lesson_attachments_lesson_asset_unique UNIQUE (lesson_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_lesson_attachments_lesson ON academy_lesson_attachments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_academy_lesson_attachments_asset ON academy_lesson_attachments(asset_id);

-- 2.5 academy_user_progress
CREATE TABLE IF NOT EXISTS academy_user_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lesson_id UUID NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  completed_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academy_user_progress_user_lesson_unique UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_user_progress_user ON academy_user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_academy_user_progress_lesson ON academy_user_progress(lesson_id);

-- 2.6 academy_vturb_snapshots (cache de métricas VTurb)
CREATE TABLE IF NOT EXISTS academy_vturb_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID REFERENCES academy_lessons(id) ON DELETE SET NULL,
  player_id TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_vturb_snapshots_lesson ON academy_vturb_snapshots(lesson_id);
CREATE INDEX IF NOT EXISTS idx_academy_vturb_snapshots_dates ON academy_vturb_snapshots(date_start, date_end);

COMMENT ON TABLE academy_modules IS 'Módulos/trilhas da Academy';
COMMENT ON TABLE academy_lessons IS 'Aulas por módulo (VTurb, iframe ou texto)';
COMMENT ON TABLE academy_assets IS 'Materiais (imagens, tabelas, PDF/DOC) no Storage';
COMMENT ON TABLE academy_lesson_attachments IS 'Anexos de cada aula';
COMMENT ON TABLE academy_user_progress IS 'Progresso do usuário por aula';
COMMENT ON TABLE academy_vturb_snapshots IS 'Cache de métricas da API VTurb Analytics';
