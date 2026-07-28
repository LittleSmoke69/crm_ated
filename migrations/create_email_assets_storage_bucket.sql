-- =====================================================
-- Storage: bucket email-assets (imagens de campanhas de e-mail)
-- Público: clientes de e-mail precisam carregar a imagem sem auth.
-- Upload: service_role (scripts/API admin).
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-assets',
  'email-assets',
  true,
  5242880, -- 5MB
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "email_assets_public_read" ON storage.objects;
CREATE POLICY "email_assets_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'email-assets');

DROP POLICY IF EXISTS "email_assets_service_role_all" ON storage.objects;
CREATE POLICY "email_assets_service_role_all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'email-assets')
  WITH CHECK (bucket_id = 'email-assets');

NOTIFY pgrst, 'reload schema';
