-- RPC: paginar evolution_webhook_events (messages.upsert em prod) com filtro opcional por texto no JSON (inclui prévia da mensagem).

CREATE OR REPLACE FUNCTION public.anti_spam_message_events_page(
  p_instance_names text[],
  p_search_substring text,
  p_limit int,
  p_offset int
)
RETURNS TABLE (
  id uuid,
  received_at timestamptz,
  instance_name text,
  remote_jid text,
  payload jsonb,
  full_total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT e.id, e.received_at, e.instance_name, e.remote_jid, e.payload
    FROM evolution_webhook_events e
    WHERE e.event_type IN ('messages.upsert', 'MESSAGES_UPSERT')
      AND e.env = 'prod'
      AND e.instance_name IS NOT NULL
      AND e.instance_name = ANY(p_instance_names)
      AND (
        p_search_substring IS NULL
        OR btrim(p_search_substring) = ''
        OR position(lower(btrim(p_search_substring)) IN lower(e.payload::text)) > 0
      )
  ),
  tot AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  paged AS (
    SELECT f.id, f.received_at, f.instance_name, f.remote_jid, f.payload
    FROM filtered f
    ORDER BY f.received_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 1), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT p.id, p.received_at, p.instance_name, p.remote_jid, p.payload, tot.total AS full_total
  FROM paged p
  CROSS JOIN tot;
$$;

COMMENT ON FUNCTION public.anti_spam_message_events_page(text[], text, int, int) IS
  'Anti-spam: lista messages.upsert (prod) por instâncias; filtro opcional case-insensitive no texto do payload JSON.';

REVOKE ALL ON FUNCTION public.anti_spam_message_events_page(text[], text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anti_spam_message_events_page(text[], text, int, int) TO service_role;

-- Total de linhas que batem no filtro (quando a página vem vazia, a função acima não devolve full_total)
CREATE OR REPLACE FUNCTION public.anti_spam_message_events_match_count(
  p_instance_names text[],
  p_search_substring text
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::bigint
  FROM evolution_webhook_events e
  WHERE e.event_type IN ('messages.upsert', 'MESSAGES_UPSERT')
    AND e.env = 'prod'
    AND e.instance_name IS NOT NULL
    AND e.instance_name = ANY(p_instance_names)
    AND btrim(p_search_substring) <> ''
    AND position(lower(btrim(p_search_substring)) IN lower(e.payload::text)) > 0;
$$;

COMMENT ON FUNCTION public.anti_spam_message_events_match_count(text[], text) IS
  'Anti-spam: conta messages.upsert (prod) cujo payload contém a substring (case-insensitive).';

REVOKE ALL ON FUNCTION public.anti_spam_message_events_match_count(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anti_spam_message_events_match_count(text[], text) TO service_role;
