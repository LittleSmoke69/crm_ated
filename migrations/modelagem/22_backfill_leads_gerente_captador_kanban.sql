-- Backfill de leads já existentes:
-- 1) Preenche gerente_id a partir do enroller do captador (quando ausente)
-- 2) Garante stage no Kanban para leads que já possuem captador
-- Idempotente: pode rodar mais de uma vez com segurança.

BEGIN;

-- 1) Vincula gerente nos leads já atribuídos a captador.
UPDATE public.crm_leads AS l
SET
  gerente_id = p.enroller,
  updated_at = now()
FROM public.profiles AS p
WHERE l.user_id = p.id
  AND p.status = 'captador'
  AND p.enroller IS NOT NULL
  AND l.gerente_id IS NULL;

-- 2) Cria stage ausente no Kanban para leads já atribuídos.
WITH candidate_leads AS (
  SELECT
    l.external_id,
    l.user_id,
    l.zaploto_id,
    l.capture_status,
    l.created_at
  FROM public.crm_leads AS l
  WHERE l.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.crm_lead_stage AS s
      WHERE s.lead_external_id = l.external_id::text
        AND s.user_id = l.user_id
    )
),
resolved_columns AS (
  SELECT
    cl.external_id,
    cl.user_id,
    cl.created_at,
    col.id AS column_id,
    col.key AS column_key
  FROM candidate_leads AS cl
  JOIN LATERAL (
    SELECT c.id, c.key
    FROM public.crm_columns AS c
    WHERE c.is_active = true
      AND (c.zaploto_id = cl.zaploto_id OR c.zaploto_id IS NULL)
      AND c.key IN (
        CASE cl.capture_status
          WHEN 'pendente' THEN 'status_pendente'
          WHEN 'em_contato' THEN 'status_em_atendimento'
          WHEN 'convertido' THEN 'status_convertido'
          WHEN 'descartado' THEN 'status_encerrado'
          ELSE 'novo'
        END,
        'novo'
      )
    ORDER BY
      (c.key = CASE cl.capture_status
        WHEN 'pendente' THEN 'status_pendente'
        WHEN 'em_contato' THEN 'status_em_atendimento'
        WHEN 'convertido' THEN 'status_convertido'
        WHEN 'descartado' THEN 'status_encerrado'
        ELSE 'novo'
      END) DESC,
      (c.zaploto_id = cl.zaploto_id) DESC,
      c.sort_order ASC
    LIMIT 1
  ) AS col ON true
),
ranked AS (
  SELECT
    rc.*,
    row_number() OVER (
      PARTITION BY rc.user_id, rc.column_key
      ORDER BY rc.created_at DESC, rc.external_id DESC
    ) - 1 AS pos
  FROM resolved_columns AS rc
)
INSERT INTO public.crm_lead_stage (
  lead_external_id,
  user_id,
  column_id,
  column_key,
  position,
  is_manual,
  moved_by,
  moved_at,
  updated_at
)
SELECT
  r.external_id::text,
  r.user_id,
  r.column_id,
  r.column_key,
  r.pos,
  true,
  r.user_id,
  now(),
  now()
FROM ranked AS r
ON CONFLICT (lead_external_id, user_id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Retorno pós-backfill: usuários e quantidade de leads.
-- Execute no SQL Editor e use este resultado para auditoria rápida.
SELECT
  COALESCE(captador.full_name, captador.email, l.user_id::text, 'SEM_CAPTADOR') AS captador,
  l.user_id AS captador_id,
  COALESCE(gerente.full_name, gerente.email, l.gerente_id::text, 'SEM_GERENTE') AS gerente,
  l.gerente_id AS gerente_id,
  COUNT(*)::int AS total_leads,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM public.crm_lead_stage s
      WHERE s.lead_external_id = l.external_id::text
        AND s.user_id = l.user_id
    )
  )::int AS leads_com_stage
FROM public.crm_leads l
LEFT JOIN public.profiles captador ON captador.id = l.user_id
LEFT JOIN public.profiles gerente ON gerente.id = l.gerente_id
GROUP BY
  COALESCE(captador.full_name, captador.email, l.user_id::text, 'SEM_CAPTADOR'),
  l.user_id,
  COALESCE(gerente.full_name, gerente.email, l.gerente_id::text, 'SEM_GERENTE'),
  l.gerente_id
ORDER BY total_leads DESC, captador;
