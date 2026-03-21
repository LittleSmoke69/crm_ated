-- =====================================================
-- Migration: Deduplica flow_instances de boas-vindas
-- Data: 2026-03
-- Descrição:
--   1) Remove linhas duplicadas com o MESMO (flow_id, instance_name, group_jid)
--      caso existam (recuperação se UNIQUE não foi aplicada no passado).
--   2) Para o template "Boas-vindas (quando entra no grupo)" (type = template),
--      mantém apenas UMA ativação por (instance_name, group_jid) — a mais antiga
--      (created_at ASC, id ASC), e remove as demais (vários flow_id no mesmo grupo).
--
-- Executar após revisar / após deduplicate_welcome_flow_templates.sql:
--   psql $DATABASE_URL -f migrations/deduplicate_welcome_flow_instances.sql
-- =====================================================

-- ── 1) Duplicatas estruturais (mesmo flow + instância + grupo) ─────────────
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY flow_id, instance_name, group_jid
      ORDER BY created_at ASC NULLS FIRST, id ASC
    ) AS rn
  FROM flow_instances
)
DELETE FROM flow_instances fi
USING ranked r
WHERE fi.id = r.id
  AND r.rn > 1;

-- ── 2) Várias ativações de boas-vindas (templates diferentes) no mesmo grupo ─
WITH welcome_rows AS (
  SELECT
    fi.id,
    ROW_NUMBER() OVER (
      PARTITION BY fi.instance_name, fi.group_jid
      ORDER BY fi.created_at ASC NULLS FIRST, fi.id ASC
    ) AS rn
  FROM flow_instances fi
  INNER JOIN flows f ON f.id = fi.flow_id
  WHERE f.name = 'Boas-vindas (quando entra no grupo)'
    AND f.type = 'template'
)
DELETE FROM flow_instances fi
USING welcome_rows w
WHERE fi.id = w.id
  AND w.rn > 1;

-- ── Consulta opcional (somente leitura) para auditar antes/depois ───────────
-- SELECT fi.instance_name, fi.group_jid, COUNT(*) AS n,
--        array_agg(f.id::text ORDER BY fi.created_at) AS flow_ids,
--        array_agg(fi.id::text ORDER BY fi.created_at) AS instance_ids
-- FROM flow_instances fi
-- JOIN flows f ON f.id = fi.flow_id
-- WHERE f.name = 'Boas-vindas (quando entra no grupo)' AND f.type = 'template'
-- GROUP BY fi.instance_name, fi.group_jid
-- HAVING COUNT(*) > 1;
