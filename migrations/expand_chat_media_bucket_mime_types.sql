-- Expande tipos MIME do bucket chat-media para áudios comuns do WhatsApp (AMR, AAC, WebM, 3GPP, etc.).
-- Sem isso, uploads com Content-Type fora da lista falham de forma intermitente conforme o aparelho/remetente.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/amr',
  'audio/webm',
  'audio/3gpp',
  'video/mp4',
  'video/3gpp',
  'application/pdf'
]::text[]
WHERE id = 'chat-media';
