-- Homolog: tenant padrão + vínculo em profiles (white label)

INSERT INTO public.zaploto_tenants (id, name, slug, app_title, is_active)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'ZapLoto Original',
  'zaploto',
  'ZapLoto',
  true
WHERE NOT EXISTS (SELECT 1 FROM public.zaploto_tenants WHERE slug = 'zaploto');

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES public.zaploto_tenants (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_zaploto ON public.profiles (zaploto_id);

UPDATE public.profiles
SET zaploto_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE zaploto_id IS NULL;

COMMENT ON COLUMN public.profiles.zaploto_id IS 'Tenant (white label); filtro de dados multi-marca';
