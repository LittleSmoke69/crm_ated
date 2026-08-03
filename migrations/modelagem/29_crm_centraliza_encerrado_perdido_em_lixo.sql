-- =====================================================
-- MODELAGEM 29 — Centraliza Encerrado / Perdido em Lixo
-- Migra cards de crm_lead_stage para a coluna Lixo e
-- desativa Encerrado / Perdido (e status_encerrado).
-- Idempotente. Rode no SQL Editor do Supabase.
-- =====================================================

DO $$
DECLARE
  v_tenant     UUID;
  v_lixo       crm_columns%ROWTYPE;
  v_src        RECORD;
  v_moved      INTEGER := 0;
  v_batch      INTEGER;
BEGIN
  FOR v_tenant IN
    SELECT id FROM zaploto_tenants WHERE COALESCE(is_active, true) = true
  LOOP
    -- Reusa Lixo existente (por key ou título); só cria se não houver nenhuma
    SELECT * INTO v_lixo
    FROM crm_columns
    WHERE zaploto_id = v_tenant
      AND (
        key = 'lixo'
        OR lower(regexp_replace(coalesce(title, ''), '[^a-zA-ZÀ-ÿ0-9]', '', 'g')) = 'lixo'
      )
    ORDER BY CASE WHEN key = 'lixo' THEN 0 ELSE 1 END,
             CASE WHEN is_active THEN 0 ELSE 1 END,
             sort_order ASC
    LIMIT 1;

    IF v_lixo.id IS NULL THEN
      INSERT INTO crm_columns (zaploto_id, key, title, color, sort_order, is_system, is_active, auto_rule)
      VALUES (v_tenant, 'lixo', 'Lixo', 'rose', 90, false, true, NULL)
      ON CONFLICT (zaploto_id, key) DO UPDATE
        SET title = 'Lixo', is_active = true, updated_at = now()
      RETURNING * INTO v_lixo;
    ELSE
      UPDATE crm_columns
         SET title = 'Lixo', is_active = true, updated_at = now()
       WHERE id = v_lixo.id;
      SELECT * INTO v_lixo FROM crm_columns WHERE id = v_lixo.id;
    END IF;

    IF v_lixo.id IS NULL THEN
      RAISE NOTICE 'Tenant % — coluna Lixo não encontrada/criada, pulando.', v_tenant;
      CONTINUE;
    END IF;

    -- Fontes a consolidar: Encerrado, Perdido, status_encerrado (e variações de título)
    FOR v_src IN
      SELECT c.*
      FROM crm_columns c
      WHERE c.zaploto_id = v_tenant
        AND c.id <> v_lixo.id
        AND (
          c.key IN ('encerrado', 'status_encerrado', 'perdido', 'perdio')
          OR lower(regexp_replace(c.title, '[^a-zA-ZÀ-ÿ0-9]', '', 'g'))
               IN ('encerrado', 'perdido', 'perdio')
        )
    LOOP
      -- Move estágios para Lixo
      WITH updated AS (
        UPDATE crm_lead_stage s
           SET column_id   = v_lixo.id,
               column_key  = v_lixo.key,
               is_manual   = true,
               moved_at    = now(),
               updated_at  = now()
         WHERE s.column_key = v_src.key
            OR s.column_id = v_src.id
        RETURNING s.lead_external_id, s.user_id, s.column_key
      ),
      hist AS (
        INSERT INTO crm_lead_stage_history (lead_external_id, user_id, from_column_key, to_column_key, moved_by)
        SELECT u.lead_external_id, u.user_id, v_src.key, v_lixo.key, u.user_id
        FROM updated u
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_batch FROM updated;
      v_moved := v_moved + COALESCE(v_batch, 0);

      -- Tags com automação de coluna (só se a coluna existir neste banco)
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'crm_tags'
          AND column_name = 'move_to_column_key'
      ) THEN
        EXECUTE format(
          'UPDATE crm_tags SET move_to_column_key = %L WHERE move_to_column_key = %L',
          v_lixo.key,
          v_src.key
        );
      END IF;

      -- Desativa coluna antiga (some do Kanban)
      UPDATE crm_columns
         SET is_active = false,
             updated_at = now()
       WHERE id = v_src.id;

      RAISE NOTICE 'Tenant % — % → % (lixo): % card(s); coluna desativada.',
        v_tenant, v_src.key, v_lixo.key, COALESCE(v_batch, 0);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Total de cards migrados para Lixo: %', v_moved;
END $$;

NOTIFY pgrst, 'reload schema';
