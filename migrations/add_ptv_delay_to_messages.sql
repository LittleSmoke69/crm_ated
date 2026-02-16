-- Migration: Adicionar suporte a Vídeo de Bolinha (PTV) na tabela messages
-- Coluna ptv_delay: delay em ms enviado para Evolution API (default 1200)

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS ptv_delay INTEGER DEFAULT 1200;

COMMENT ON COLUMN messages.ptv_delay IS 'Delay em ms para envio PTV (Vídeo de Bolinha). Usado quando message_type = ptv. Default 1200.';
