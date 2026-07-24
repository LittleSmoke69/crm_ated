-- Heartbeat atômico: impede que várias abas somem o mesmo intervalo online.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS online_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS crm_heartbeat_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.record_user_heartbeat(
  p_user_id UUID,
  p_is_crm BOOLEAN DEFAULT false
)
RETURNS TABLE (total_online_time INTEGER, total_crm_time INTEGER, last_seen_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  RETURN QUERY
  UPDATE public.profiles p
     SET total_online_time = COALESCE(p.total_online_time, 0) +
           CASE
             WHEN p.online_heartbeat_at IS NULL THEN 0
             ELSE LEAST(60, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - p.online_heartbeat_at)))::INTEGER))
           END,
         total_crm_time = COALESCE(p.total_crm_time, 0) +
           CASE
             WHEN NOT p_is_crm OR p.crm_heartbeat_at IS NULL THEN 0
             ELSE LEAST(60, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - p.crm_heartbeat_at)))::INTEGER))
           END,
         online_heartbeat_at = v_now,
         crm_heartbeat_at = CASE WHEN p_is_crm THEN v_now ELSE p.crm_heartbeat_at END,
         last_seen_at = v_now,
         updated_at = v_now
   WHERE p.id = p_user_id
   RETURNING p.total_online_time, p.total_crm_time, p.last_seen_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_user_heartbeat(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_user_heartbeat(UUID, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
