-- Agregação de volume de mensagens por instância Evolution (relatório gestão do chat).
-- Chamada via service role; não expor a anon.
--
-- Idempotente: remove assinaturas antigas antes de recriar (evita 42P13 no SQL Editor).

DROP FUNCTION IF EXISTS public.chat_message_counts_by_instance(uuid[], timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.chat_message_counts_by_instance(
  p_instance_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  instance_id uuid,
  msg_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_instance_ids IS NULL OR cardinality(p_instance_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.instance_id,
    COUNT(*)::bigint AS msg_count
  FROM public.chat_messages m
  WHERE m.instance_id = ANY (p_instance_ids)
    AND m.created_at >= p_from
    AND m.created_at <= p_to
  GROUP BY m.instance_id;
END;
$function$;

COMMENT ON FUNCTION public.chat_message_counts_by_instance(uuid[], timestamptz, timestamptz) IS
  'Conta mensagens por evolution instance_id no intervalo (created_at), para relatório operacional.';

GRANT EXECUTE ON FUNCTION public.chat_message_counts_by_instance(uuid[], timestamptz, timestamptz) TO service_role;
