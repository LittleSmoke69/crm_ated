-- Gestão do chat: métricas da equipe (admin + gerente + captador) e fila do gerente.
-- Em atendimento do gerente conta conversas com gerente_id = ele (ainda sem captador).
-- Idempotente.

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
  -- Fila direta do captador (user_id) + fila do gerente aguardando captador (gerente_id, user_id null)
  conv_stats AS (
    SELECT
      s.uid AS user_id,
      count(*) FILTER (
        WHERE COALESCE(c.attendance_status, 'pendente') <> 'resolvido'
          AND (
            c.user_id = s.uid
            OR (c.gerente_id = s.uid AND c.user_id IS NULL)
          )
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
          AND (
            c.user_id = s.uid
            OR (c.gerente_id = s.uid AND c.user_id IS NULL)
          )
      )::bigint AS fora_janela
    FROM suporte s
    LEFT JOIN chat_conversations c
      ON c.user_id = s.uid
      OR (c.gerente_id = s.uid AND c.user_id IS NULL)
    GROUP BY s.uid
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
  'Métricas por admin/gerente/captador: msgs no período + fila em atendimento (captador ou gerente aguardando).';

NOTIFY pgrst, 'reload schema';
