-- =====================================================
-- RPC: get_expired_transfer_stats
-- Retorna total_expired_logs, total_pending_entries, banca_ids e list (para a API transfer-logs/expired).
-- Parâmetros: p_banca_ids uuid[], p_source_consultant_email text (opcional).
-- Utiliza apenas a query com CTEs conforme especificado.
-- =====================================================

CREATE OR REPLACE FUNCTION get_expired_transfer_stats(
  p_banca_ids uuid[],
  p_source_consultant_email text DEFAULT NULL
)
RETURNS TABLE (
  total_expired_logs bigint,
  total_pending_entries bigint,
  banca_ids uuid[],
  list jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH logs_expirados AS (
    SELECT l.id, l.banca_id, l.created_at, l.deadline_days,
           l.source_consultant_email, l.target_consultant_email, l.count, l.transfer_type
    FROM admin_lead_transfer_logs l
    WHERE l.banca_id = ANY(p_banca_ids)
      AND (p_source_consultant_email IS NULL OR l.source_consultant_email ILIKE p_source_consultant_email)
      AND (CURRENT_DATE - (l.created_at::date)) >= COALESCE(NULLIF(l.deadline_days, 0), 10)
  ),
  ids_com_pendentes AS (
    SELECT DISTINCT e.transfer_log_id
    FROM admin_lead_transfer_entries e
    WHERE e.transfer_log_id IN (SELECT id FROM logs_expirados)
      AND e.resolution_status = 'pending'
  ),
  expired_with_pending AS (
    SELECT le.*
    FROM logs_expirados le
    WHERE le.id IN (SELECT transfer_log_id FROM ids_com_pendentes)
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM expired_with_pending),
    (SELECT COUNT(*)::bigint FROM admin_lead_transfer_entries e
     WHERE e.transfer_log_id IN (SELECT id FROM expired_with_pending)
       AND e.resolution_status = 'pending'),
    (SELECT array_agg(DISTINCT banca_id) FROM expired_with_pending),
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'id', ewp.id,
          'banca_id', ewp.banca_id,
          'created_at', ewp.created_at,
          'deadline_days', COALESCE(NULLIF(ewp.deadline_days, 0), 10),
          'source_consultant_email', COALESCE(ewp.source_consultant_email, ''),
          'target_consultant_email', COALESCE(ewp.target_consultant_email, ''),
          'count', COALESCE(ewp.count, 0),
          'transfer_type', COALESCE(ewp.transfer_type, 'TF'),
          'to_resolve', (SELECT COUNT(*)::int FROM admin_lead_transfer_entries e2
                         WHERE e2.transfer_log_id = ewp.id AND e2.resolution_status = 'pending')
        )
      ) FROM expired_with_pending ewp),
      '[]'::jsonb
    )
  FROM (SELECT 1) _;
$$;

COMMENT ON FUNCTION get_expired_transfer_stats(uuid[], text) IS
  'Retorna totais e lista de transferências expiradas com pendentes; usado pela API GET /api/admin/crm/transfer-logs/expired';
