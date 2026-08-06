-- TAG de aquisição na tela Leads: ADS | Disparo | Campanha
-- ADS = chat de atendimento · Disparo = massa/broadcast · Campanha = import CSV/TXT

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS acquisition_tag TEXT NULL;

COMMENT ON COLUMN public.crm_leads.acquisition_tag IS
  'Canal de aquisição: ads | disparo | campanha';

ALTER TABLE public.crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_acquisition_tag_check;

ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_acquisition_tag_check
  CHECK (acquisition_tag IS NULL OR acquisition_tag IN ('ads', 'disparo', 'campanha'));

CREATE INDEX IF NOT EXISTS idx_crm_leads_acquisition_tag
  ON public.crm_leads (acquisition_tag)
  WHERE acquisition_tag IS NOT NULL;

-- Backfill: import → Campanha
UPDATE public.crm_leads
   SET acquisition_tag = 'campanha',
       updated_at = NOW()
 WHERE acquisition_tag IS NULL
   AND lower(coalesce(source, '')) = 'import';

-- Backfill: chat / Evolution / WhatsApp Oficial → ADS
UPDATE public.crm_leads
   SET acquisition_tag = 'ads',
       updated_at = NOW()
 WHERE acquisition_tag IS NULL
   AND (
     chat_conversation_id IS NOT NULL
     OR lower(coalesce(source, '')) IN ('evolution', 'chat', 'whatsapp_official')
   );

NOTIFY pgrst, 'reload schema';
