-- Reserva atômica (job_id, group_id) antes do POST à Evolution: evita duplicata quando
-- dois workers veem o mesmo processed_index ou quando o envio já ocorreu e o CAS do índice falhou.
-- Estados: linha com error_message = '__IN_FLIGHT__' = envio em curso; após persist, success/erro real.
-- Busca por JID canônico ou legado (ex.: só dígitos vs …@g.us) para não criar segunda linha do mesmo grupo.

CREATE OR REPLACE FUNCTION public.claim_activation_mass_send_group(
  p_job_id UUID,
  p_group_id TEXT,
  p_now TIMESTAMPTZ,
  p_in_flight_stale_seconds INT DEFAULT 900
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.activation_mass_send_job_groups%ROWTYPE;
  stale_threshold TIMESTAMPTZ;
  bare_id TEXT;
BEGIN
  p_group_id := NULLIF(LOWER(TRIM(p_group_id)), '');
  IF p_group_id IS NULL THEN
    RETURN 'invalid_group';
  END IF;

  stale_threshold := p_now - (GREATEST(p_in_flight_stale_seconds, 60) * INTERVAL '1 second');
  bare_id := regexp_replace(p_group_id, '@g\.us$', '');

  SELECT * INTO r
  FROM public.activation_mass_send_job_groups
  WHERE job_id = p_job_id
    AND (group_id = p_group_id OR group_id = bare_id)
  ORDER BY success DESC, updated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.activation_mass_send_job_groups (job_id, group_id, success, error_message, created_at, updated_at)
    VALUES (p_job_id, p_group_id, false, '__IN_FLIGHT__', p_now, p_now);
    RETURN 'send';
  END IF;

  IF r.success = true THEN
    RETURN 'already_ok';
  END IF;

  IF r.error_message = '__IN_FLIGHT__' AND r.updated_at > stale_threshold THEN
    RETURN 'in_flight';
  END IF;

  IF r.error_message = '__IN_FLIGHT__' AND r.updated_at <= stale_threshold THEN
    UPDATE public.activation_mass_send_job_groups
    SET
      group_id = CASE
        WHEN r.group_id IS DISTINCT FROM p_group_id
          AND NOT EXISTS (
            SELECT 1 FROM public.activation_mass_send_job_groups x
            WHERE x.job_id = p_job_id AND x.group_id = p_group_id AND x.id <> r.id
          )
        THEN p_group_id
        ELSE r.group_id
      END,
      error_message = '__IN_FLIGHT__',
      updated_at = p_now
    WHERE job_id = p_job_id AND group_id = r.group_id AND success = false;
    RETURN 'send';
  END IF;

  UPDATE public.activation_mass_send_job_groups
  SET
    group_id = CASE
      WHEN r.group_id IS DISTINCT FROM p_group_id
        AND NOT EXISTS (
          SELECT 1 FROM public.activation_mass_send_job_groups x
          WHERE x.job_id = p_job_id AND x.group_id = p_group_id AND x.id <> r.id
        )
      THEN p_group_id
      ELSE r.group_id
    END,
    error_message = '__IN_FLIGHT__',
    updated_at = p_now
  WHERE job_id = p_job_id AND group_id = r.group_id AND success = false;

  RETURN 'send';
END;
$$;

COMMENT ON FUNCTION public.claim_activation_mass_send_group(UUID, TEXT, TIMESTAMPTZ, INT) IS
  'already_ok | send | in_flight | invalid_group — reserva grupo antes do disparo Evolution (anti-duplicata).';

GRANT EXECUTE ON FUNCTION public.claim_activation_mass_send_group(UUID, TEXT, TIMESTAMPTZ, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_activation_mass_send_group(UUID, TEXT, TIMESTAMPTZ, INT) TO authenticated;
