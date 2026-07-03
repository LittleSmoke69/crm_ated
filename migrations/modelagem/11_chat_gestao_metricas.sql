-- =====================================================
-- MODELAGEM 11 — GESTÃO DO CHAT (métricas de suporte + colunas em profiles)
-- Corrige /api/admin/chat-support-activity (last_login_at + RPC).
-- Depende de: 00 (profiles), 09 (chat_messages, chat_conversations).
-- Idempotente.
-- =====================================================

-- Colunas usadas por heartbeat, login e relatório de suporte
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS total_online_time INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_zaploto ON profiles(zaploto_id);

COMMENT ON COLUMN profiles.last_seen_at IS 'Última atividade (heartbeat) na plataforma';
COMMENT ON COLUMN profiles.total_online_time IS 'Tempo total online em segundos';
COMMENT ON COLUMN profiles.last_login_at IS 'Último login bem-sucedido';

-- Agrega atendimentos da equipe de suporte (WhatsApp oficial + Evolution)
CREATE OR REPLACE FUNCTION chat_support_activity(
  p_user_ids UUID[],
  p_from_sec BIGINT,
  p_to_sec BIGINT
)
RETURNS TABLE (
  user_id UUID,
  atendimentos BIGINT,
  mensagens BIGINT,
  em_atendimento BIGINT,
  fora_janela BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH suporte AS (
    SELECT unnest(p_user_ids) AS uid
  ),
  msgs AS (
    SELECT m.user_id, m.conversation_id
    FROM chat_messages m
    WHERE m.user_id = ANY(p_user_ids)
      AND (m.from_me = true OR m.direction = 'out')
      AND (p_from_sec IS NULL OR m.timestamp >= p_from_sec)
      AND (p_to_sec IS NULL OR m.timestamp <= p_to_sec)
  ),
  msg_agg AS (
    SELECT m.user_id,
           count(*)::bigint AS mensagens,
           count(DISTINCT m.conversation_id)::bigint AS atendimentos
    FROM msgs m
    GROUP BY m.user_id
  ),
  conv_stats AS (
    SELECT c.user_id,
      count(*) FILTER (
        WHERE COALESCE(c.attendance_status, 'pendente') <> 'resolvido'
          AND (
            c.whatsapp_config_id IS NULL
            OR c.last_customer_message_at IS NULL
            OR c.last_customer_message_at > now() - interval '24 hours'
          )
      )::bigint AS em_atendimento,
      count(*) FILTER (
        WHERE c.whatsapp_config_id IS NOT NULL
          AND c.last_customer_message_at IS NOT NULL
          AND c.last_customer_message_at <= now() - interval '24 hours'
          AND COALESCE(c.attendance_status, 'pendente') <> 'resolvido'
      )::bigint AS fora_janela
    FROM chat_conversations c
    WHERE c.user_id = ANY(p_user_ids)
    GROUP BY c.user_id
  )
  SELECT
    s.uid,
    COALESCE(m.atendimentos, 0),
    COALESCE(m.mensagens, 0),
    COALESCE(cs.em_atendimento, 0),
    COALESCE(cs.fora_janela, 0)
  FROM suporte s
  LEFT JOIN msg_agg m ON m.user_id = s.uid
  LEFT JOIN conv_stats cs ON cs.user_id = s.uid;
$$;

GRANT EXECUTE ON FUNCTION chat_support_activity(UUID[], BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION chat_support_activity(UUID[], BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION chat_support_activity IS
  'Métricas por atendente suporte: conversas/mensagens no período + fila em atendimento / fora da janela 24h (oficial).';
