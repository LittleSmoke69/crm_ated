-- Bucket para mídias do fluxo de mensagens do Auto maturador (vídeo, imagem, áudio)
-- Usado por /api/admin/maturation/virgin-messages/upload e maturation-tick
INSERT INTO storage.buckets (id, name, public)
VALUES ('virgin-maturation-media', 'virgin-maturation-media', false)
ON CONFLICT (id) DO NOTHING;
