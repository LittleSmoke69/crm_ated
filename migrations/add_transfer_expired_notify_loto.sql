-- =====================================================
-- Notificação Loto Assistente quando prazo de transferência expira (10 dias)
-- 1) Marca em admin_lead_transfer_logs que a notificação já foi enviada
-- 2) Chaves em system_settings para perfil destino e template da mensagem
-- =====================================================

-- Evita reenviar notificação para a mesma transferência
ALTER TABLE admin_lead_transfer_logs
  ADD COLUMN IF NOT EXISTS transfer_expired_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN admin_lead_transfer_logs.transfer_expired_notified_at IS 'Data/hora em que a notificação de prazo expirado foi enviada via Loto Assistente (uma vez por transferência).';

-- Perfil (user id) que recebe a mensagem no WhatsApp (telefone do perfil)
INSERT INTO system_settings (key, value, updated_at)
  VALUES ('loto_assistencia_notify_user_id', '', NOW())
  ON CONFLICT (key) DO NOTHING;

-- Template da mensagem (placeholders: {{Banca}}, {{DataTransferencia}}, {{ConsultorOrigem}}, {{ConsultorDestino}}, {{QuantidadeLeads}})
INSERT INTO system_settings (key, value, updated_at)
  VALUES (
    'loto_assistencia_message_transfer_expired',
    '⏱️ *Zaploto – Prazo de transferência encerrado*
Banca: {{Banca}}
Data da transferência: {{DataTransferencia}}
Origem: {{ConsultorOrigem}}
Destino: {{ConsultorDestino}}
Leads: {{QuantidadeLeads}}

Acesse Admin → Transferência de Leads para resolver (vincular ou repassar).',
    NOW()
  )
  ON CONFLICT (key) DO NOTHING;
