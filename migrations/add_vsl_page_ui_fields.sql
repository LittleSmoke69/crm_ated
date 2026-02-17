-- =====================================================
-- Migration: Campos de UI da VSL (header, marquee, depoimentos)
-- Data: 2026-02-09
-- Descrição: Título do topo personalizável, frase em marquee, depoimentos no modelo rede social.
-- =====================================================

-- Título exibido no header vermelho (ex: FINANÇAS)
ALTER TABLE vsl_pages
  ADD COLUMN IF NOT EXISTS header_title text NOT NULL DEFAULT 'FINANÇAS';

-- Frase abaixo do título com animação em loop (ex: ATUALIZAÇÕES DIÁRIAS...)
ALTER TABLE vsl_pages
  ADD COLUMN IF NOT EXISTS marquee_text text NOT NULL DEFAULT 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS';

-- Depoimentos: array de { author_name, author_avatar_url?, content, likes_count? }
ALTER TABLE vsl_pages
  ADD COLUMN IF NOT EXISTS testimonials jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN vsl_pages.header_title IS 'Título do topo vermelho da VSL (personalizável pelo gestor)';
COMMENT ON COLUMN vsl_pages.marquee_text IS 'Frase em animação contínua abaixo do título';
COMMENT ON COLUMN vsl_pages.testimonials IS 'Lista de depoimentos: [{ author_name, author_avatar_url?, content, likes_count? }]';
