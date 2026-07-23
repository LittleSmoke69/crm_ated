-- =====================================================
-- MODELAGEM 15 — branding Cap do Sucesso
-- Remove os valores padrão ZapLoto e unifica a cor primária do painel.
-- =====================================================

UPDATE public.zaploto_tenants
SET name = 'Cap do Sucesso',
    app_title = 'Cap do Sucesso',
    domain = 'capdosucesso.co.uk',
    primary_color = '#E86A24',
    secondary_color = '#C9531A',
    updated_at = now()
WHERE slug = 'zaploto';

NOTIFY pgrst, 'reload schema';
