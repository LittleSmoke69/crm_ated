-- White label: eventos do webhook Evolution associados ao tenant (slug na URL → x-zaploto-slug).
-- Substitui o unique (instance_name, message_id) por versões com escopo de tenant.

ALTER TABLE evolution_webhook_events
  ADD COLUMN IF NOT EXISTS zaploto_id uuid REFERENCES zaploto_tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN evolution_webhook_events.zaploto_id IS 'Tenant (white label) quando o POST veio de /{slug}/api/webhooks/evolution/...; NULL = URL central /api/...';

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_zaploto_id
  ON evolution_webhook_events (zaploto_id)
  WHERE zaploto_id IS NOT NULL;

-- Idempotência: um registro por (instance, message) no escopo null OU no escopo tenant
DROP INDEX IF EXISTS idx_evolution_webhook_events_instance_message_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_webhook_events_inst_msg_zaploto_null
  ON evolution_webhook_events (instance_name, message_id)
  WHERE message_id IS NOT NULL AND zaploto_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_webhook_events_inst_msg_zaploto_set
  ON evolution_webhook_events (instance_name, message_id, zaploto_id)
  WHERE message_id IS NOT NULL AND zaploto_id IS NOT NULL;
