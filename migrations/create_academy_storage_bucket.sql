-- =====================================================
-- Storage: bucket academy-assets
-- Upload: admin/super_admin. Download: público se publicado; preferir signed URLs para PDF/DOC
-- Aceita: .pdf, .doc, .docx, .png, .jpg, .jpeg, .webp
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'academy-assets',
  'academy-assets',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Política: service_role full access
CREATE POLICY "academy_assets_storage_service_role"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'academy-assets')
  WITH CHECK (bucket_id = 'academy-assets');

-- Política: authenticated com perfil admin pode fazer upload/update/delete
CREATE POLICY "academy_assets_storage_admin_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'academy-assets'
    AND public.is_academy_admin()
  );

CREATE POLICY "academy_assets_storage_admin_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'academy-assets' AND public.is_academy_admin())
  WITH CHECK (bucket_id = 'academy-assets');

CREATE POLICY "academy_assets_storage_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'academy-assets' AND public.is_academy_admin());

-- Política: leitura para todos (anon + authenticated) - signed URLs ou público conforme regra de negócio
-- Para arquivos sensíveis use signed URL gerada no backend
CREATE POLICY "academy_assets_storage_select"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'academy-assets');
