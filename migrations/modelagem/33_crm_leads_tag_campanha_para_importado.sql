-- Renomeia TAG de aquisição: campanha → importado

COMMENT ON COLUMN public.crm_leads.acquisition_tag IS
  'Canal de aquisição: ads | disparo | importado';

ALTER TABLE public.crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_acquisition_tag_check;

UPDATE public.crm_leads
   SET acquisition_tag = 'importado',
       updated_at = NOW()
 WHERE acquisition_tag = 'campanha';

ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_acquisition_tag_check
  CHECK (acquisition_tag IS NULL OR acquisition_tag IN ('ads', 'disparo', 'importado'));

NOTIFY pgrst, 'reload schema';
