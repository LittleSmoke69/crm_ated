-- ============================================
-- MATURAÇÃO VIRGEM: CAMPOS EM evolution_instances
-- ============================================
-- Diferencia números virgens de maturados; fluxo automático 5 dias com bloqueio.

-- Colunas em evolution_instances
ALTER TABLE evolution_instances
  ADD COLUMN IF NOT EXISTS maturation_type TEXT NOT NULL DEFAULT 'maturado'
    CHECK (maturation_type IN ('virgem', 'maturado')),
  ADD COLUMN IF NOT EXISTS maturation_status TEXT
    CHECK (maturation_status IS NULL OR maturation_status IN (
      'waiting_connection_test',
      'contact_warmup',
      'group_warmup',
      'posting_status',
      'repeating_cycle',
      'completed'
    )),
  ADD COLUMN IF NOT EXISTS maturation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maturation_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maturation_phase_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maturation_last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_day INTEGER CHECK (current_day IS NULL OR (current_day >= 1 AND current_day <= 5)),
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maturation_paused_at TIMESTAMPTZ;

COMMENT ON COLUMN evolution_instances.maturation_type IS 'virgem = auto maturação 5 dias; maturado = fluxo normal';
COMMENT ON COLUMN evolution_instances.maturation_status IS 'Estado atual da maturação virgem';
COMMENT ON COLUMN evolution_instances.is_locked IS 'Instância bloqueada (em maturação virgem ou bloqueio admin)';

CREATE INDEX IF NOT EXISTS idx_evolution_instances_maturation_type ON evolution_instances(maturation_type);
CREATE INDEX IF NOT EXISTS idx_evolution_instances_maturation_status ON evolution_instances(maturation_status) WHERE maturation_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_instances_is_locked ON evolution_instances(is_locked) WHERE is_locked = true;

-- Tabela: grupos criados para warmup em maturação virgem
CREATE TABLE IF NOT EXISTS virgin_maturation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_instance_id UUID NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(evolution_instance_id)
);

CREATE INDEX IF NOT EXISTS idx_virgin_maturation_groups_evolution_instance_id ON virgin_maturation_groups(evolution_instance_id);
CREATE INDEX IF NOT EXISTS idx_virgin_maturation_groups_group_jid ON virgin_maturation_groups(group_jid);

-- Tabela: logs de maturação virgem (admin)
CREATE TABLE IF NOT EXISTS virgin_maturation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_instance_id UUID NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  payload_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_virgin_maturation_logs_evolution_instance_id ON virgin_maturation_logs(evolution_instance_id);
CREATE INDEX IF NOT EXISTS idx_virgin_maturation_logs_created_at ON virgin_maturation_logs(created_at DESC);

ALTER TABLE virgin_maturation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE virgin_maturation_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access virgin_maturation_logs"
  ON virgin_maturation_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access virgin_maturation_groups"
  ON virgin_maturation_groups FOR ALL TO service_role USING (true) WITH CHECK (true);
