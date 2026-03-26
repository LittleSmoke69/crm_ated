-- =====================================================
-- Storage: bucket brand-assets (VSL white-label)
-- Logos, template Bolão, vídeos de depoimento — paths sob bancas/<project_id>/...
-- Upload: rotas /api/admin/vsl/* com supabaseServiceRole
-- Leitura: signed URLs geradas no servidor (bucket privado)
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  false,
  104857600,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "service_role_all_brand_assets" ON storage.objects;

CREATE POLICY "service_role_all_brand_assets"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'brand-assets')
  WITH CHECK (bucket_id = 'brand-assets');
