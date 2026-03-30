-- Homolog: bancas CRM + vínculo multi-banca por usuário (JSONB, como em produção)

CREATE TABLE IF NOT EXISTS public.crm_bancas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.crm_bancas
  ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES public.zaploto_tenants (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_crm_bancas_zaploto ON public.crm_bancas (zaploto_id);

UPDATE public.crm_bancas
SET zaploto_id = '00000000-0000-0000-0000-000000000001'::uuid
WHERE zaploto_id IS NULL;

COMMENT ON TABLE public.crm_bancas IS 'Bancas para integração CRM / hierarquia';
COMMENT ON COLUMN public.crm_bancas.zaploto_id IS 'Tenant da banca (white label)';

ALTER TABLE public.crm_bancas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read crm_bancas" ON public.crm_bancas;
DROP POLICY IF EXISTS "Admins can modify crm_bancas" ON public.crm_bancas;

CREATE POLICY "Authenticated users can read crm_bancas"
  ON public.crm_bancas FOR SELECT
  USING (true);

CREATE POLICY "Admins can modify crm_bancas"
  ON public.crm_bancas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.status = 'admin'
    )
  );

-- Uma linha por usuário: banca_ids = array JSON de UUIDs em string
CREATE TABLE IF NOT EXISTS public.user_bancas (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  banca_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  PRIMARY KEY (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_bancas_user_id ON public.user_bancas (user_id);
CREATE INDEX IF NOT EXISTS idx_user_bancas_banca_ids_gin ON public.user_bancas USING GIN (banca_ids);

COMMENT ON TABLE public.user_bancas IS 'Bancas em que consultor/gerente/gestor atua';
COMMENT ON COLUMN public.user_bancas.banca_ids IS 'Array de UUIDs (como string) das bancas';

ALTER TABLE public.user_bancas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own user_bancas" ON public.user_bancas;
DROP POLICY IF EXISTS "Consultor Gerente Gestor SuperAdmin can manage own user_bancas" ON public.user_bancas;

CREATE POLICY "Users can read own user_bancas"
  ON public.user_bancas FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Consultor Gerente Gestor SuperAdmin can manage own user_bancas"
  ON public.user_bancas FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.status IN ('consultor', 'gerente', 'super_admin', 'gestor')
    )
  );
