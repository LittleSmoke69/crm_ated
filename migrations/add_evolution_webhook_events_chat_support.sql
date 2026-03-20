-- =====================================================
-- Migration: Suporte ao chat na tabela evolution_webhook_events
-- Adiciona coluna processed_at para rastrear eventos processados pelo chat,
-- índices de performance e habilita Realtime para o frontend.
-- =====================================================

-- Coluna de controle de processamento (igual ao webhook_events da WA Oficial)
ALTER TABLE evolution_webhook_events
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

-- Índice para busca eficiente de eventos não processados por instância
CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_chat_pending
  ON evolution_webhook_events (instance_name, received_at)
  WHERE processed_at IS NULL;

-- Habilita Realtime para que o frontend seja notificado de novos eventos
ALTER PUBLICATION supabase_realtime ADD TABLE evolution_webhook_events;
