-- Campos necessários para importar leads vinculados a gerente/captador.
-- Idempotente: seguro em instalações onde a migration legada já foi aplicada.

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS capture_status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS gerente_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NULL,
  ADD COLUMN IF NOT EXISTS zaploto_id UUID NULL REFERENCES public.zaploto_tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_crm_leads_capture_status
  ON public.crm_leads (capture_status);

CREATE INDEX IF NOT EXISTS idx_crm_leads_gerente
  ON public.crm_leads (gerente_id);

CREATE INDEX IF NOT EXISTS idx_crm_leads_zaploto
  ON public.crm_leads (zaploto_id);
