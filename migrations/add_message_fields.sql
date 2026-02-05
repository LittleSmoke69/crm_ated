-- =====================================================
-- Migration: Adicionar campos adicionais na tabela messages
-- Data: 2026
-- Descrição: Adiciona campos para anexo com legenda, Dev.IA, mencionar todos, tipo de mensagem
-- =====================================================

-- Adiciona coluna mention_all (mencionar todos os usuários do grupo)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS mention_all BOOLEAN DEFAULT FALSE;

-- Adiciona coluna attachment_with_caption (anexo com legenda)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS attachment_with_caption BOOLEAN DEFAULT FALSE;

-- Adiciona coluna use_dev_ia (usar Dev.IA)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS use_dev_ia BOOLEAN DEFAULT FALSE;

-- Adiciona coluna message_type (tipo de mensagem)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text_only';

-- Adiciona coluna attachment_url (URL do anexo)
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS attachment_url TEXT;

-- Comentários para documentação
COMMENT ON COLUMN messages.mention_all IS 'Indica se a mensagem deve mencionar todos os usuários do grupo';
COMMENT ON COLUMN messages.attachment_with_caption IS 'Indica se o anexo possui legenda';
COMMENT ON COLUMN messages.use_dev_ia IS 'Indica se deve usar Dev.IA para gerar a mensagem';
COMMENT ON COLUMN messages.message_type IS 'Tipo de mensagem: text_only, text_with_attachment, audio';
COMMENT ON COLUMN messages.attachment_url IS 'URL do arquivo anexado à mensagem';

