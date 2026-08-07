-- Adiciona TAG de aquisição "ligacao" (exibida como Ligação na tela Leads)

COMMENT ON COLUMN public.crm_leads.acquisition_tag IS
  'Canal de aquisição: ads | disparo | importado | ligacao';

ALTER TABLE public.crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_acquisition_tag_check;

ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_acquisition_tag_check
  CHECK (acquisition_tag IS NULL OR acquisition_tag IN ('ads', 'disparo', 'importado', 'ligacao'));

NOTIFY pgrst, 'reload schema';
