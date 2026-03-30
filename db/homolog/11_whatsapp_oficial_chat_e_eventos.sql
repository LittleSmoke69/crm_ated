-- Homolog: WhatsApp Cloud API (oficial) — configs, fila de eventos, chat e mídia.
-- Espelha create_whatsapp_official_configs, add_whatsapp_official_chat_support,
-- add_webhook_events_processed_at, fix_chat_conversations_upsert_constraint, create_chat_media_storage.
-- Depende: profiles, zaploto_tenants, evolution_instances (homolog 02–06).

-- ---------------------------------------------------------------------------
-- 1) Configuração por tenant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_official_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'WhatsApp Oficial',
  is_active BOOLEAN DEFAULT true,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  graph_version TEXT NOT NULL DEFAULT 'v25.0',
  access_token TEXT NOT NULL,
  verify_token TEXT NOT NULL,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_official_configs_zaploto
  ON public.whatsapp_official_configs (zaploto_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_official_configs_active
  ON public.whatsapp_official_configs (is_active)
  WHERE is_active = true;

COMMENT ON TABLE public.whatsapp_official_configs IS
  'WhatsApp Cloud API por tenant; credenciais apenas via service role / backend';

ALTER TABLE public.whatsapp_official_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_official_configs_select_admin ON public.whatsapp_official_configs;
DROP POLICY IF EXISTS whatsapp_official_configs_insert_admin ON public.whatsapp_official_configs;
DROP POLICY IF EXISTS whatsapp_official_configs_update_admin ON public.whatsapp_official_configs;
DROP POLICY IF EXISTS whatsapp_official_configs_delete_admin ON public.whatsapp_official_configs;

CREATE POLICY whatsapp_official_configs_select_admin ON public.whatsapp_official_configs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status IN ('super_admin', 'admin')
    )
  );

CREATE POLICY whatsapp_official_configs_insert_admin ON public.whatsapp_official_configs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status IN ('super_admin', 'admin')
    )
  );

CREATE POLICY whatsapp_official_configs_update_admin ON public.whatsapp_official_configs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status IN ('super_admin', 'admin')
    )
  );

CREATE POLICY whatsapp_official_configs_delete_admin ON public.whatsapp_official_configs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status IN ('super_admin', 'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.set_whatsapp_official_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_official_configs_updated_at ON public.whatsapp_official_configs;
CREATE TRIGGER whatsapp_official_configs_updated_at
  BEFORE UPDATE ON public.whatsapp_official_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_whatsapp_official_configs_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Eventos brutos do webhook (POST /api/webhooks/whatsapp-official)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'whatsapp_official',
  event_name TEXT NOT NULL DEFAULT 'whatsapp_official',
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON public.webhook_events (source);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON public.webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
  ON public.webhook_events (processed_at)
  WHERE processed_at IS NULL;

COMMENT ON COLUMN public.webhook_events.processed_at IS
  'Preenchido após processar payload em chat_conversations/chat_messages';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'webhook_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_events;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Evolution: colunas usadas pelo chat (Evolution + legado create_chat_tables)
-- ---------------------------------------------------------------------------
UPDATE public.evolution_apis SET api_key_global = api_key
WHERE (api_key_global IS NULL OR api_key_global = '') AND api_key IS NOT NULL AND api_key <> '';

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS webhook_configured BOOLEAN DEFAULT false;
ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS is_chat_instance BOOLEAN DEFAULT false;

-- ---------------------------------------------------------------------------
-- 4) Conversas e mensagens (Evolution + oficial); conflict_key para upsert PostgREST
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  user_id UUID REFERENCES public.profiles (id),
  instance_id UUID REFERENCES public.evolution_instances (id) ON DELETE CASCADE,
  whatsapp_config_id UUID REFERENCES public.whatsapp_official_configs (id) ON DELETE CASCADE,
  remote_jid TEXT NOT NULL,
  title TEXT,
  profile_pic_url TEXT,
  is_group BOOLEAN DEFAULT false,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  last_customer_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  conflict_key TEXT GENERATED ALWAYS AS (
    CASE
      WHEN instance_id IS NOT NULL THEN 'i-' || instance_id::text
      WHEN whatsapp_config_id IS NOT NULL THEN 'w-' || whatsapp_config_id::text
      ELSE NULL
    END
  ) STORED,
  CONSTRAINT chat_conversations_exactly_one_channel CHECK (
    (instance_id IS NOT NULL AND whatsapp_config_id IS NULL)
    OR (instance_id IS NULL AND whatsapp_config_id IS NOT NULL)
  )
);

COMMENT ON COLUMN public.chat_conversations.conflict_key IS
  'Upsert PostgREST: i-{instance_id} ou w-{whatsapp_config_id}';
COMMENT ON COLUMN public.chat_conversations.last_customer_message_at IS
  'Última mensagem inbound do contato (janela 24h WhatsApp oficial)';

-- Remove unicidade antiga (instance_id, remote_jid) se existir de migrações prévias
ALTER TABLE public.chat_conversations
  DROP CONSTRAINT IF EXISTS chat_conversations_instance_id_remote_jid_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_conflict_key_remote_jid
  ON public.chat_conversations (conflict_key, remote_jid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_instance_remote
  ON public.chat_conversations (instance_id, remote_jid)
  WHERE instance_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_whatsapp_config_remote
  ON public.chat_conversations (whatsapp_config_id, remote_jid)
  WHERE whatsapp_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_instance_id ON public.chat_conversations (instance_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_workspace_id ON public.chat_conversations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_customer_message_at
  ON public.chat_conversations (last_customer_message_at DESC)
  WHERE whatsapp_config_id IS NOT NULL;

ALTER TABLE public.chat_conversations
  ALTER COLUMN instance_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  user_id UUID REFERENCES public.profiles (id),
  instance_id UUID REFERENCES public.evolution_instances (id) ON DELETE CASCADE,
  whatsapp_config_id UUID REFERENCES public.whatsapp_official_configs (id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations (id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('in', 'out')),
  from_me BOOLEAN DEFAULT false,
  sender_jid TEXT,
  text TEXT,
  media_type TEXT,
  media_url TEXT,
  caption TEXT,
  status TEXT DEFAULT 'pending',
  timestamp BIGINT,
  provider TEXT NOT NULL DEFAULT 'evolution',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.chat_messages
  ALTER COLUMN instance_id DROP NOT NULL;

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_instance_id_message_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_conversation_message
  ON public.chat_messages (conversation_id, message_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_message_id_provider
  ON public.chat_messages (message_id, provider)
  WHERE provider = 'whatsapp_official';

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON public.chat_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_workspace_id ON public.chat_messages (workspace_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_instance_id_remote_jid ON public.chat_messages (instance_id, sender_jid);

-- ---------------------------------------------------------------------------
-- 5) RPC usada pelo processador do webhook oficial
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_unread_count(conv_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_conversations
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE id = conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_unread_count(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_unread_count(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Storage: bucket de mídias do oficial (resolveAndStoreMedia)
-- ---------------------------------------------------------------------------
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

DROP POLICY IF EXISTS "service_role_all_chat_media" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_chat_media" ON storage.objects;
DROP POLICY IF EXISTS "anon_read_chat_media" ON storage.objects;

CREATE POLICY "service_role_all_chat_media"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'chat-media')
  WITH CHECK (bucket_id = 'chat-media');

CREATE POLICY "authenticated_read_chat_media"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media');

CREATE POLICY "anon_read_chat_media"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'chat-media');

-- ---------------------------------------------------------------------------
-- 7) Realtime (chat atendimento + webhook_events) — evita CHANNEL_ERROR
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
  END IF;
END $$;

ALTER TABLE public.chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

ALTER TABLE public.chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages DISABLE ROW LEVEL SECURITY;
