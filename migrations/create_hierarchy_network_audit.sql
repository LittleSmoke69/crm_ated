-- =====================================================
-- Migration: Auditoria de alterações na rede (hierarquia)
-- Descrição: Eventos registrados pelas APIs admin ao alterar usuários,
--            vínculos com bancas, etc. Leitura restrita a super_admin (via API).
-- =====================================================

CREATE TABLE IF NOT EXISTS hierarchy_network_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zaploto_id UUID,
  actor_id UUID NOT NULL,
  actor_email TEXT,
  actor_status TEXT,
  action TEXT NOT NULL,
  target_user_id UUID,
  summary TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS idx_hierarchy_network_audit_created_at ON hierarchy_network_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hierarchy_network_audit_zaploto ON hierarchy_network_audit (zaploto_id);
CREATE INDEX IF NOT EXISTS idx_hierarchy_network_audit_actor ON hierarchy_network_audit (actor_id);

COMMENT ON TABLE hierarchy_network_audit IS 'Trilha de auditoria: quem alterou a rede (hierarquia, bancas, perfis) — consumo via API service role';

ALTER TABLE hierarchy_network_audit ENABLE ROW LEVEL SECURITY;

-- Sem políticas para client anon/authenticated: apenas service role (rotas Next) grava e super_admin lê via API.
