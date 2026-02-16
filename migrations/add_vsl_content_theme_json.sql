-- =====================================================
-- Migration: content_json e theme_json para VSL Builder
-- Data: 2026-02-09
-- Descrição: Permite páginas VSL renderizadas por blocos (newsTopbar, headlineRich, etc.).
-- Quando content_json é preenchido, a página pública usa o renderizador de blocos.
-- =====================================================

ALTER TABLE vsl_pages
  ADD COLUMN IF NOT EXISTS content_json jsonb NULL;

ALTER TABLE vsl_pages
  ADD COLUMN IF NOT EXISTS theme_json jsonb NULL;

COMMENT ON COLUMN vsl_pages.content_json IS 'Árvore de blocos (page, newsTopbar, headlineRich, vturbVideo, buttonCTA, etc.). Se NULL, usa layout legado.';
COMMENT ON COLUMN vsl_pages.theme_json IS 'Tema/estilos globais aplicados ao renderizador de blocos.';
