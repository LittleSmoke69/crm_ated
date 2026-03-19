-- =============================================================================
-- Verificação: Total Lucro Realizado (resolvidas) — mesma lógica da API resolved-stats
-- Rodar no Supabase SQL Editor. Ajuste os filtros opcionais no final se quiser.
-- =============================================================================

WITH
  -- Prazo padrão quando deadline_days é null ou 0
  default_deadline AS (SELECT 10 AS days),

  -- Logs cujo prazo já expirou (created_at + deadline_days <= now())
  logs_expirados AS (
    SELECT
      l.id,
      l.banca_id,
      l.created_at,
      l.deadline_days,
      l.transfer_type,
      l.source_consultant_email
    FROM admin_lead_transfer_logs l
    CROSS JOIN default_deadline d
    WHERE (l.created_at + ((COALESCE(NULLIF(l.deadline_days, 0), d.days)) * INTERVAL '1 day')) <= now()
      -- Filtros opcionais (descomente e ajuste para bater com a tela):
      -- AND l.banca_id = 'SEU_BANCA_ID'
      -- AND l.created_at >= '2025-01-01'::date
      -- AND l.created_at < ('2025-12-31'::date + INTERVAL '1 day')
      -- AND l.source_consultant_email ILIKE '%@email%'
  ),

  -- Logs expirados que têm ao menos um entry com resolution_status != 'pending' (resolvidos)
  logs_resolvidos AS (
    SELECT DISTINCT l.id
    FROM logs_expirados l
    INNER JOIN admin_lead_transfer_entries e ON e.transfer_log_id = l.id AND e.banca_id = l.banca_id
    WHERE e.resolution_status IS NOT NULL AND e.resolution_status != 'pending'
  ),

  -- Entries vinculadas com snapshot de depósito (base do lucro)
  entries_vinculadas_com_deposito AS (
    SELECT
      e.id AS entry_id,
      e.transfer_log_id,
      e.banca_id,
      e.lead_id,
      e.target_consultant_email,
      e.resolution_status,
      COALESCE(e.total_depositado_snapshot, 0)::numeric AS dep_antes,
      COALESCE(e.current_total_depositado_at_resolution, 0)::numeric AS dep_depois,
      COALESCE(e.total_apostado_snapshot, 0)::numeric AS ap_antes,
      COALESCE(e.current_total_apostado_at_resolution, 0)::numeric AS ap_depois
    FROM admin_lead_transfer_entries e
    INNER JOIN logs_resolvidos r ON r.id = e.transfer_log_id
    WHERE e.resolution_status = 'vinculado'
      AND e.total_depositado_snapshot IS NOT NULL
  )

-- Totais (equivalente ao retorno da API)
SELECT
  COUNT(DISTINCT transfer_log_id)::int AS total_resolved_logs,
  SUM(dep_antes)::numeric(18,2) AS total_depositado_antes,
  SUM(dep_depois)::numeric(18,2) AS total_depositado_depois,
  SUM(
    CASE
      WHEN dep_antes = 0 THEN dep_depois
      ELSE GREATEST(0, dep_depois - dep_antes)
    END
  )::numeric(18,2) AS total_lucro_realizado,
  SUM(
    CASE
      WHEN ap_antes = 0 THEN ap_depois
      ELSE GREATEST(0, ap_depois - ap_antes)
    END
  )::numeric(18,2) AS total_aposta_realizado,
  COUNT(*)::int AS total_entries_vinculadas_com_snapshot
FROM entries_vinculadas_com_deposito;


-- =============================================================================
-- Opcional: detalhe por transferência (para conferir linha a linha)
-- Copie todo o bloco FROM "WITH" até o "LIMIT 500" e rode em uma nova execução.
-- =============================================================================
/*
WITH default_deadline AS (SELECT 10 AS days),
  logs_expirados AS (
    SELECT l.id, l.banca_id, l.created_at, l.deadline_days, l.transfer_type, l.source_consultant_email
    FROM admin_lead_transfer_logs l
    CROSS JOIN default_deadline d
    WHERE (l.created_at + ((COALESCE(NULLIF(l.deadline_days, 0), d.days)) * INTERVAL '1 day')) <= now()
  ),
  logs_resolvidos AS (
    SELECT DISTINCT l.id FROM logs_expirados l
    INNER JOIN admin_lead_transfer_entries e ON e.transfer_log_id = l.id AND e.banca_id = l.banca_id
    WHERE e.resolution_status IS NOT NULL AND e.resolution_status != 'pending'
  ),
  entries_vinculadas_com_deposito AS (
    SELECT e.transfer_log_id, e.banca_id, e.lead_id,
      COALESCE(e.total_depositado_snapshot, 0)::numeric AS dep_antes,
      COALESCE(e.current_total_depositado_at_resolution, 0)::numeric AS dep_depois
    FROM admin_lead_transfer_entries e
    INNER JOIN logs_resolvidos r ON r.id = e.transfer_log_id
    WHERE e.resolution_status = 'vinculado' AND e.total_depositado_snapshot IS NOT NULL
  )
SELECT transfer_log_id, banca_id, lead_id, dep_antes, dep_depois,
  (dep_depois - dep_antes) AS diff_dep,
  CASE WHEN dep_antes = 0 THEN dep_depois ELSE GREATEST(0, dep_depois - dep_antes) END AS lucro_entrada
FROM entries_vinculadas_com_deposito
ORDER BY transfer_log_id, lead_id
LIMIT 500;
*/
