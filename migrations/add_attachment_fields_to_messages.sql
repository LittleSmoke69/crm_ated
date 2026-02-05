-- =====================================================
-- Migration: Adicionar campos de mídia na tabela messages
-- Data: 2024
-- Descrição: Adiciona campos para suportar upload de mídia (imagem/vídeo/áudio)
-- Nota: Os campos attachment_url, attachment_with_caption, use_dev_ia, mention_all e message_type
-- já podem existir na tabela (ver migrations/add_message_fields.sql)
-- =====================================================

-- Adiciona colunas para mídia se não existirem
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS attachment_type TEXT CHECK (attachment_type IN ('image', 'video', 'audio')) NULL,
ADD COLUMN IF NOT EXISTS attachment_mime TEXT NULL,
ADD COLUMN IF NOT EXISTS attachment_size BIGINT NULL;

-- Comentários para documentação
COMMENT ON COLUMN messages.attachment_type IS 'Tipo de mídia: image, video ou audio';
COMMENT ON COLUMN messages.attachment_mime IS 'MIME type do arquivo (ex: image/jpeg, video/mp4, audio/mpeg)';
COMMENT ON COLUMN messages.attachment_size IS 'Tamanho do arquivo em bytes';

