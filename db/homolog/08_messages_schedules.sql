-- Homolog: mensagens modeladas + colunas usadas em ativações / PTV / anexos + agendamentos (worker)

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  preview TEXT,
  category TEXT DEFAULT 'Boas vindas',
  is_favorite BOOLEAN DEFAULT false,
  has_attachment BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages (created_at DESC);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mention_all BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_with_caption BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS use_dev_ia BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text_only';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS send_intelligent BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS training_asset_id UUID;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS training_dataset_item_id UUID;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ptv_delay INTEGER DEFAULT 1200;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can create own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;

CREATE POLICY "Service role full access messages"
  ON public.messages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can view own messages"
  ON public.messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own messages"
  ON public.messages FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages"
  ON public.messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Agendamentos (process-message-queue)
CREATE TABLE IF NOT EXISTS public.message_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'recurring')),
  scheduled_at_utc TIMESTAMPTZ,
  cron_expr TEXT,
  timezone TEXT DEFAULT 'America/Recife',
  recurring_days TEXT[],
  recurring_time TIME,
  next_run_utc TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled', 'paused')),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_schedules_status ON public.message_schedules (status);
CREATE INDEX IF NOT EXISTS idx_message_schedules_next_run ON public.message_schedules (next_run_utc);
CREATE INDEX IF NOT EXISTS idx_message_schedules_user ON public.message_schedules (user_id);
CREATE INDEX IF NOT EXISTS idx_message_schedules_due ON public.message_schedules (status, next_run_utc)
  WHERE status = 'scheduled' AND next_run_utc IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_message_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_message_schedules_updated_at ON public.message_schedules;
CREATE TRIGGER trigger_update_message_schedules_updated_at
  BEFORE UPDATE ON public.message_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_message_schedules_updated_at();

ALTER TABLE public.message_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own message schedules" ON public.message_schedules;
DROP POLICY IF EXISTS "Users can create their own message schedules" ON public.message_schedules;
DROP POLICY IF EXISTS "Users can update their own message schedules" ON public.message_schedules;
DROP POLICY IF EXISTS "Users can delete their own message schedules" ON public.message_schedules;

CREATE POLICY "Users can view their own message schedules"
  ON public.message_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own message schedules"
  ON public.message_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own message schedules"
  ON public.message_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own message schedules"
  ON public.message_schedules FOR DELETE USING (auth.uid() = user_id);
