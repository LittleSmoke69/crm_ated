-- =====================================================
-- MODELAGEM 03 — CHAT INTERNO (API OFICIAL) + ATENDIMENTO MULTI-ATENDENTE + MÉTRICAS
-- Objetivo: unificar o atendimento pela WhatsApp Cloud API (oficial) num único
--           lugar, onde vários usuários do cargo "suporte" atendem a mesma
--           caixa de entrada, com claim de conversas e métricas de chat.
-- Contexto já existente (não recriado aqui):
--   chat_conversations.provider/whatsapp_config_id, attendance_status,
--   assigned_at, resolved_at, tags  (ver add_whatsapp_official_chat_support.sql
--   e add_chat_conversations_attendance_metrics.sql)
-- Idempotente. NÃO recria o banco.
-- =====================================================

-- 1) MÉTRICAS ADICIONAIS NA CONVERSA -------------------------------------------
--    Primeira resposta do atendente (TMPR — tempo médio de primeira resposta).
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS first_response_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
-- Prioridade opcional para a fila (0 = normal).
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN chat_conversations.first_response_at IS
  'Primeira mensagem de saída após a atribuição. TMPR = first_response_at - assigned_at.';

CREATE INDEX IF NOT EXISTS idx_chat_conversations_official_queue
  ON chat_conversations (whatsapp_config_id, attendance_status, priority DESC, last_message_at ASC)
  WHERE whatsapp_config_id IS NOT NULL;

-- 2) POOL DE ATENDENTES DO NÚMERO OFICIAL --------------------------------------
--    Quem (suporte) atende cada número oficial. Todos compartilham UMA caixa.
CREATE TABLE IF NOT EXISTS chat_agent_pool (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_config_id UUID NOT NULL REFERENCES whatsapp_official_configs(id) ON DELETE CASCADE,
  agent_user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  is_online          BOOLEAN NOT NULL DEFAULT false, -- disponível para receber claim
  max_open           INTEGER,                        -- limite de conversas abertas simultâneas
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (whatsapp_config_id, agent_user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_agent_pool_config
  ON chat_agent_pool (whatsapp_config_id) WHERE is_active = true;

COMMENT ON TABLE chat_agent_pool IS 'Atendentes (suporte) vinculados a cada número oficial; caixa de entrada compartilhada.';

-- 3) EVENTOS DE ATENDIMENTO (fonte de verdade das métricas) --------------------
CREATE TABLE IF NOT EXISTS chat_attendance_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  agent_user_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN
                     ('assigned','first_response','resolved','reopened','transferred','unassigned')),
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attendance_events_conv
  ON chat_attendance_events (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_attendance_events_agent
  ON chat_attendance_events (agent_user_id, event_type, created_at DESC);

COMMENT ON TABLE chat_attendance_events IS 'Log append-only de eventos de atendimento (base para métricas de chat).';

-- 4) RPC: pegar a próxima conversa da fila (claim) -----------------------------
--    Atribui ao atendente a conversa oficial pendente mais antiga ainda sem dono,
--    respeitando prioridade. Concorrência segura via FOR UPDATE SKIP LOCKED.
CREATE OR REPLACE FUNCTION chat_claim_next_official(
  p_whatsapp_config_id UUID,
  p_agent_user_id      UUID
) RETURNS chat_conversations AS $$
DECLARE
  v_conv chat_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv
  FROM chat_conversations
  WHERE whatsapp_config_id = p_whatsapp_config_id
    AND (attendance_status IS NULL OR attendance_status = 'pendente')
    AND user_id IS NULL
  ORDER BY priority DESC, last_message_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_conv.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE chat_conversations
     SET user_id = p_agent_user_id,
         assigned_at = now(),
         attendance_status = 'pendente'
   WHERE id = v_conv.id
  RETURNING * INTO v_conv;

  INSERT INTO chat_attendance_events (conversation_id, agent_user_id, event_type)
  VALUES (v_conv.id, p_agent_user_id, 'assigned');

  RETURN v_conv;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION chat_claim_next_official IS 'Claim: atribui a próxima conversa oficial pendente ao atendente (fila compartilhada).';

-- 5) RPC: registrar primeira resposta ------------------------------------------
CREATE OR REPLACE FUNCTION chat_mark_first_response(
  p_conversation_id UUID,
  p_agent_user_id   UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE chat_conversations
     SET first_response_at = now(),
         first_response_by = p_agent_user_id
   WHERE id = p_conversation_id
     AND first_response_at IS NULL;

  IF FOUND THEN
    INSERT INTO chat_attendance_events (conversation_id, agent_user_id, event_type)
    VALUES (p_conversation_id, p_agent_user_id, 'first_response');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6) RPC: resolver conversa ----------------------------------------------------
CREATE OR REPLACE FUNCTION chat_resolve_conversation(
  p_conversation_id UUID,
  p_agent_user_id   UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE chat_conversations
     SET attendance_status = 'resolvido',
         resolved_at = now()
   WHERE id = p_conversation_id;

  INSERT INTO chat_attendance_events (conversation_id, agent_user_id, event_type)
  VALUES (p_conversation_id, p_agent_user_id, 'resolved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7) VIEW: métricas diárias por atendente --------------------------------------
CREATE OR REPLACE VIEW chat_attendance_metrics_daily AS
SELECT
  date_trunc('day', c.assigned_at)::date               AS dia,
  c.user_id                                            AS agent_user_id,
  c.whatsapp_config_id,
  count(*)                                             AS conversas_atribuidas,
  count(*) FILTER (WHERE c.attendance_status = 'resolvido')       AS conversas_resolvidas,
  count(*) FILTER (WHERE c.first_response_at IS NOT NULL)         AS conversas_respondidas,
  avg(EXTRACT(EPOCH FROM (c.first_response_at - c.assigned_at)))
    FILTER (WHERE c.first_response_at IS NOT NULL)     AS tmpr_seg,   -- 1ª resposta (s)
  avg(EXTRACT(EPOCH FROM (c.resolved_at - c.assigned_at)))
    FILTER (WHERE c.resolved_at IS NOT NULL)           AS tmr_seg     -- resolução (s)
FROM chat_conversations c
WHERE c.assigned_at IS NOT NULL
GROUP BY date_trunc('day', c.assigned_at), c.user_id, c.whatsapp_config_id;

COMMENT ON VIEW chat_attendance_metrics_daily IS
  'Métricas de chat por atendente/dia: volume, resolvidas, TMPR e TMR (segundos).';

-- 8) RLS -----------------------------------------------------------------------
ALTER TABLE chat_agent_pool         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attendance_events  ENABLE ROW LEVEL SECURITY;

-- Pool: o atendente vê o seu vínculo; admin/super_admin gerenciam.
DROP POLICY IF EXISTS chat_agent_pool_read ON chat_agent_pool;
CREATE POLICY chat_agent_pool_read ON chat_agent_pool
  FOR SELECT USING (
    agent_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
               AND p.status IN ('super_admin','admin','suporte'))
  );

DROP POLICY IF EXISTS chat_agent_pool_admin_write ON chat_agent_pool;
CREATE POLICY chat_agent_pool_admin_write ON chat_agent_pool
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
            AND p.status IN ('super_admin','admin'))
  );

-- Eventos: suporte/admin leem; escrita via RPC (service_role/SECURITY DEFINER).
DROP POLICY IF EXISTS chat_attendance_events_read ON chat_attendance_events;
CREATE POLICY chat_attendance_events_read ON chat_attendance_events
  FOR SELECT USING (
    agent_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
               AND p.status IN ('super_admin','admin','suporte'))
  );

-- 9) Realtime (inbox ao vivo) --------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_attendance_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_attendance_events;
    END IF;
  END IF;
END $$;
