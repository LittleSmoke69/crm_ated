-- =====================================================
-- RPC: get_resolved_transfer_stats
-- Mesma lógica do SQL de verificação (docs/SQL_VERIFICACAO_LUCRO_REALIZADO.sql).
-- Retorna totais de transferências resolvidas e lucro realizado para a API resolved-stats.
-- Parâmetros: p_banca_ids uuid[] (null ou vazio = todas), p_from date, p_to date, p_source_consultant_email text.
-- =====================================================

CREATE OR REPLACE FUNCTION get_resolved_transfer_stats(
  p_banca_ids uuid[] DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_source_consultant_email text DEFAULT NULL
)
RETURNS TABLE (
  total_resolved_logs bigint,
  total_depositado_antes numeric,
  total_depositado_depois numeric,
  total_lucro_realizado numeric,
  total_aposta_realizado numeric,
  total_disponivel bigint,
  by_type jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    default_deadline AS (SELECT 10 AS days),

    -- Logs cujo prazo já expirou (mesma fórmula do SQL de verificação)
    logs_expirados AS (
      SELECT l.id, l.banca_id, l.created_at, l.deadline_days, l.transfer_type, l.source_consultant_email
      FROM admin_lead_transfer_logs l
      CROSS JOIN default_deadline d
      WHERE (p_banca_ids IS NULL OR cardinality(p_banca_ids) = 0 OR l.banca_id = ANY(p_banca_ids))
        AND (p_from IS NULL OR l.created_at::date >= p_from)
        AND (p_to IS NULL OR l.created_at::date <= p_to)
        AND (p_source_consultant_email IS NULL OR l.source_consultant_email ILIKE p_source_consultant_email)
        AND (l.created_at + ((COALESCE(NULLIF(l.deadline_days, 0), d.days)) * INTERVAL '1 day')) <= now()
    ),

    logs_resolvidos AS (
      SELECT DISTINCT l.id
      FROM logs_expirados l
      INNER JOIN admin_lead_transfer_entries e ON e.transfer_log_id = l.id AND e.banca_id = l.banca_id
      WHERE e.resolution_status IS NOT NULL AND e.resolution_status != 'pending'
    ),

    entries_vinculadas_com_deposito AS (
      SELECT
        e.transfer_log_id,
        COALESCE(e.total_depositado_snapshot, 0)::numeric AS dep_antes,
        COALESCE(e.current_total_depositado_at_resolution, 0)::numeric AS dep_depois,
        COALESCE(e.total_apostado_snapshot, 0)::numeric AS ap_antes,
        COALESCE(e.current_total_apostado_at_resolution, 0)::numeric AS ap_depois
      FROM admin_lead_transfer_entries e
      INNER JOIN logs_resolvidos r ON r.id = e.transfer_log_id
      WHERE e.resolution_status = 'vinculado'
        AND e.total_depositado_snapshot IS NOT NULL
    ),

    agregado AS (
      SELECT
        (SELECT COUNT(DISTINCT transfer_log_id)::bigint FROM entries_vinculadas_com_deposito) AS total_resolved_logs,
        (SELECT COALESCE(SUM(dep_antes), 0)::numeric FROM entries_vinculadas_com_deposito) AS total_depositado_antes,
        (SELECT COALESCE(SUM(dep_depois), 0)::numeric FROM entries_vinculadas_com_deposito) AS total_depositado_depois,
        (SELECT COALESCE(SUM(CASE WHEN dep_antes = 0 THEN dep_depois ELSE GREATEST(0, dep_depois - dep_antes) END), 0)::numeric FROM entries_vinculadas_com_deposito) AS total_lucro_realizado,
        (SELECT COALESCE(SUM(CASE WHEN ap_antes = 0 THEN ap_depois ELSE GREATEST(0, ap_depois - ap_antes) END), 0)::numeric FROM entries_vinculadas_com_deposito) AS total_aposta_realizado,
        (SELECT COUNT(*)::bigint FROM admin_lead_transfer_entries e
         WHERE e.transfer_log_id IN (SELECT id FROM logs_resolvidos)
           AND e.resolution_status = 'disponivel_retransferencia') AS total_disponivel
      FROM (SELECT 1) _
    ),

    by_type_raw AS (
      SELECT le.transfer_type, COUNT(*)::bigint AS cnt
      FROM logs_expirados le
      INNER JOIN admin_lead_transfer_entries e ON e.transfer_log_id = le.id AND e.resolution_status = 'disponivel_retransferencia'
      WHERE le.id IN (SELECT id FROM logs_resolvidos)
      GROUP BY le.transfer_type
    )
  SELECT
    a.total_resolved_logs,
    a.total_depositado_antes,
    a.total_depositado_depois,
    a.total_lucro_realizado,
    a.total_aposta_realizado,
    a.total_disponivel,
    COALESCE(
      (SELECT jsonb_object_agg(COALESCE(bt.transfer_type, 'TF'), bt.cnt) FROM by_type_raw bt),
      '{"TF": 0, "TF1": 0, "TF2": 0, "TF3": 0}'::jsonb
    )
  FROM agregado a;
$$;

COMMENT ON FUNCTION get_resolved_transfer_stats(uuid[], date, date, text) IS
  'Totais de transferências resolvidas e lucro realizado; mesma lógica do SQL de verificação. Usado pela API GET /api/admin/crm/transfer-logs/resolved-stats';
