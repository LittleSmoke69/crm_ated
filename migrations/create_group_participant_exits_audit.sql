-- =====================================================
-- Migration: Auditoria de saídas de participantes (group-participants.update action: remove)
-- Data: 2026-01-30
-- Descrição: Registra saídas/remoções de usuários em grupos WhatsApp para gestão por banca, grupo e período.
-- Hierarquia: Banca → Grupo → Evento → Usuário
-- =====================================================

CREATE TABLE IF NOT EXISTS group_participant_exits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_instance_id UUID NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  banca_id UUID REFERENCES crm_bancas(id) ON DELETE SET NULL,
  group_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'remove',
  event_type TEXT NOT NULL,
  author TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

COMMENT ON TABLE group_participant_exits IS 'Auditoria: saídas/remoções de participantes em grupos (evento group-participants.update action remove)';
COMMENT ON COLUMN group_participant_exits.evolution_instance_id IS 'Instância Evolution que recebeu o evento';
COMMENT ON COLUMN group_participant_exits.banca_id IS 'Banca (crm_bancas) resolvida a partir do dono da instância; nullable se não houver vínculo';
COMMENT ON COLUMN group_participant_exits.group_id IS 'ID do grupo (JID, ex: 120363403357540053@g.us)';
COMMENT ON COLUMN group_participant_exits.phone IS 'Número de telefone normalizado (apenas dígitos, sem @s.whatsapp.net)';
COMMENT ON COLUMN group_participant_exits.action IS 'Ação do evento (sempre remove para esta tabela)';
COMMENT ON COLUMN group_participant_exits.event_type IS 'Tipo do evento (ex: group-participants.update)';
COMMENT ON COLUMN group_participant_exits.author IS 'Quem removeu/saiu (se existir no payload)';
COMMENT ON COLUMN group_participant_exits.occurred_at IS 'Data/hora do evento';
COMMENT ON COLUMN group_participant_exits.payload IS 'Payload bruto opcional para auditoria';

-- Índices para gestão por banca, grupo e período
CREATE INDEX IF NOT EXISTS idx_group_participant_exits_banca_id
  ON group_participant_exits(banca_id) WHERE banca_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_participant_exits_group_id
  ON group_participant_exits(group_id);

CREATE INDEX IF NOT EXISTS idx_group_participant_exits_occurred_at
  ON group_participant_exits(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_group_participant_exits_banca_occurred
  ON group_participant_exits(banca_id, occurred_at DESC) WHERE banca_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_participant_exits_group_occurred
  ON group_participant_exits(group_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_group_participant_exits_phone
  ON group_participant_exits(phone);

CREATE INDEX IF NOT EXISTS idx_group_participant_exits_instance_id
  ON group_participant_exits(evolution_instance_id);

-- RLS: leitura para perfis admin, dono_banca, gerente, auditoria; escrita apenas via service role (backend)
ALTER TABLE group_participant_exits ENABLE ROW LEVEL SECURITY;

-- Leitura: admin, dono_banca, gerente, auditoria. Inserções apenas pelo backend (service role).
CREATE POLICY "Auditoria e gestores podem ler group_participant_exits"
  ON group_participant_exits
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.status IN ('admin', 'dono_banca', 'gerente', 'auditoria')
    )
  );
