-- Listagem /api/admin/webhooks/evolution/events: filtro env + order received_at; filtro zaploto_id (WL)
-- Reduz sequencial scan + sort em tabelas grandes (evita statement timeout no COUNT/SELECT)
--
-- Garante coluna zaploto_id (mesma regra que add_zaploto_id_evolution_webhook_events.sql), para poder
-- rodar este ficheiro mesmo se a outra migração ainda não tiver sido aplicada.

ALTER TABLE evolution_webhook_events
  ADD COLUMN IF NOT EXISTS zaploto_id uuid REFERENCES zaploto_tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evo_webhook_events_env_received_at
  ON evolution_webhook_events (env, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_evo_webhook_events_tenant_env_received
  ON evolution_webhook_events (zaploto_id, env, received_at DESC)
  WHERE zaploto_id IS NOT NULL;
