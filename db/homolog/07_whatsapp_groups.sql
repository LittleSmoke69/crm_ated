-- Homolog: cache de grupos por instância (listagens CRM / ativações)

CREATE TABLE IF NOT EXISTS public.whatsapp_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_subject TEXT,
  picture_url TEXT,
  size INTEGER,
  user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_user_instance ON public.whatsapp_groups (user_id, instance_name);
CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_instance_group ON public.whatsapp_groups (instance_name, group_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_groups_unique_user_instance_group
  ON public.whatsapp_groups (
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    instance_name,
    group_id
  );
