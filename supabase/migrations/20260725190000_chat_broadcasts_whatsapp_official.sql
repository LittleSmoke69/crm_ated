-- Disparo em massa também para WhatsApp Oficial (templates Meta), reaproveitando
-- a mesma fila/tabela do disparo em massa via Evolution (chat_broadcasts):
-- mesma persistência, pausa/retomar/cancelar, histórico e o mecanismo de
-- step-claim que evita envio duplicado entre o loop do navegador e o cron.
--
-- instance_id (Evolution) deixa de ser obrigatório: um job de WhatsApp Oficial
-- não tem instância Evolution, e sim uma config (whatsapp_config_id).

ALTER TABLE public.chat_broadcasts
  ALTER COLUMN instance_id DROP NOT NULL,
  ALTER COLUMN instance_name DROP NOT NULL;

ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS channel_type TEXT NOT NULL DEFAULT 'evolution',
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES public.whatsapp_official_configs(id) ON DELETE CASCADE;

ALTER TABLE public.chat_broadcasts
  DROP CONSTRAINT IF EXISTS chat_broadcasts_channel_type_check;
ALTER TABLE public.chat_broadcasts
  ADD CONSTRAINT chat_broadcasts_channel_type_check CHECK (channel_type IN ('evolution', 'whatsapp_official'));

COMMENT ON COLUMN public.chat_broadcasts.channel_type IS 'evolution (padrão, legado) | whatsapp_official — define qual processador o process-next usa.';
COMMENT ON COLUMN public.chat_broadcasts.whatsapp_config_id IS 'Config do WhatsApp Oficial (Meta) usada quando channel_type=whatsapp_official; substitui instance_id/instance_name desse fluxo.';
COMMENT ON COLUMN public.chat_broadcasts.message_config IS 'Evolution: {steps:[...], sequence_delay_seconds, rotation_size}. WhatsApp Oficial: {template_name, template_language, template_params: string[]} — sem sequência, 1 template por contato.';

CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_whatsapp_config
  ON public.chat_broadcasts (whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;
