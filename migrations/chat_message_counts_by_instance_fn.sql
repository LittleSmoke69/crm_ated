-- Agregação de volume de mensagens por instância Evolution (relatório gestão do chat).
-- Chamada via service role; não expor a anon.

CREATE OR REPLACE FUNCTION public.chat_message_counts_by_instance(
  p_instance_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (instance_id uuid, msg_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.instance_id, COUNT(*)::bigint AS msg_count
  FROM public.chat_messages m
  WHERE cardinality(p_instance_ids) > 0
    AND m.instance_id = ANY(p_instance_ids)
    AND m.created_at >= p_from
    AND m.created_at <= p_to
  GROUP BY m.instance_id;
$$;

COMMENT ON FUNCTION public.chat_message_counts_by_instance(uuid[], timestamptz, timestamptz) IS
  'Conta mensagens por evolution instance_id no intervalo (created_at), para relatório operacional.';

GRANT EXECUTE ON FUNCTION public.chat_message_counts_by_instance(uuid[], timestamptz, timestamptz) TO service_role;
