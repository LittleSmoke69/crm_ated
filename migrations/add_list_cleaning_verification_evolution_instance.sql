-- Limpeza de Lista: instância Evolution usada na verificação WhatsApp (chat/whatsappNumbers)
ALTER TABLE list_cleaning_jobs
  ADD COLUMN IF NOT EXISTS verification_evolution_instance_id UUID NULL REFERENCES evolution_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_list_cleaning_jobs_verification_evolution_instance
  ON list_cleaning_jobs(verification_evolution_instance_id)
  WHERE verification_evolution_instance_id IS NOT NULL;

COMMENT ON COLUMN list_cleaning_jobs.verification_evolution_instance_id IS 'Evolution instance usada em POST /chat/whatsappNumbers/{instance}; definida na 1ª verificação.';
