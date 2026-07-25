-- Disparo de template (WhatsApp Cloud API / Meta) — guarda o que foi enviado
-- para exibir na bolha do chat (nome do template + texto já com as variáveis
-- substituídas), já que a Meta não devolve o texto renderizado na resposta do envio.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS template_name TEXT,
  ADD COLUMN IF NOT EXISTS template_language TEXT,
  ADD COLUMN IF NOT EXISTS template_components JSONB;

COMMENT ON COLUMN public.chat_messages.template_name IS 'Nome do template Meta disparado (media_type = ''template''); NULL para as demais mensagens.';
COMMENT ON COLUMN public.chat_messages.template_language IS 'Código de idioma do template disparado (ex.: pt_BR), conforme cadastrado na Meta.';
COMMENT ON COLUMN public.chat_messages.template_components IS 'Components enviados à Cloud API (variáveis preenchidas pelo agente) — auditoria/depuração.';
