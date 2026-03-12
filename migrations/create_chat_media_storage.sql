-- =====================================================
-- Storage: bucket chat-media (mídias do chat WhatsApp Oficial)
-- Upload: webhook (resolveAndStoreMedia) e rota upload-media. Leitura: pública (URL permanente).
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  true,
  104857600,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/ogg', 'audio/mpeg', 'audio/mp4',
    'video/mp4', 'video/3gpp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy: service_role pode fazer tudo (webhook e API usam supabaseServiceRole)
CREATE POLICY "service_role_all_chat_media"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'chat-media')
WITH CHECK (bucket_id = 'chat-media');

-- Policy: autenticados podem ler (e anon para bucket público)
CREATE POLICY "authenticated_read_chat_media"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'chat-media');

CREATE POLICY "anon_read_chat_media"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'chat-media');
