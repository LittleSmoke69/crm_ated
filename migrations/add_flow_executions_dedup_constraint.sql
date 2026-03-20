-- =====================================================
-- Migration: Deduplicação de execuções de flow
-- Evita que o mesmo evento dispare o mesmo flow mais de uma vez
-- mesmo que a Evolution API entregue o webhook múltiplas vezes.
-- =====================================================

-- UNIQUE constraint: um flow só pode ser executado uma vez por evento
ALTER TABLE flow_executions
  ADD CONSTRAINT IF NOT EXISTS uq_flow_executions_flow_event
  UNIQUE (flow_id, trigger_event_id);

-- Índice para busca rápida por conteúdo de evento (dedup por fingerprint)
CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_fingerprint
  ON evolution_webhook_events (event_type, instance_name, remote_jid, created_at DESC)
  WHERE event_type IN ('group-participants.update', 'GROUP_PARTICIPANTS_UPDATE');
