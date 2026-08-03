-- =====================================================
-- MODELAGEM 30 — Une colunas "Lixo" duplicadas em uma só
-- Idempotente. Rode no SQL Editor do Supabase.
-- =====================================================

DO $$
DECLARE
  v_tenant   UUID;
  v_keep     crm_columns%ROWTYPE;
  v_dup      RECORD;
  v_moved    INTEGER := 0;
  v_batch    INTEGER;
  v_new_key  TEXT;
BEGIN
  FOR v_tenant IN
    SELECT id FROM zaploto_tenants WHERE COALESCE(is_active, true) = true
  LOOP
    -- Canônica: key = 'lixo' se existir; senão a primeira com título Lixo
    SELECT * INTO v_keep
    FROM crm_columns
    WHERE zaploto_id = v_tenant
      AND (
        key = 'lixo'
        OR lower(regexp_replace(coalesce(title, ''), '[^a-zA-ZÀ-ÿ0-9]', '', 'g')) = 'lixo'
      )
    ORDER BY
      CASE WHEN key = 'lixo' THEN 0 ELSE 1 END,
      CASE WHEN is_active THEN 0 ELSE 1 END,
      sort_order ASC NULLS LAST,
      created_at ASC NULLS LAST
    LIMIT 1;

    IF v_keep.id IS NULL THEN
      RAISE NOTICE 'Tenant % — nenhuma coluna Lixo encontrada.', v_tenant;
      CONTINUE;
    END IF;

    -- Garante título/active da canônica (não troca key se já for outra e existir key=lixo)
    UPDATE crm_columns
       SET title = 'Lixo',
           is_active = true,
           color = COALESCE(NULLIF(color, ''), 'rose'),
           updated_at = now()
     WHERE id = v_keep.id;

    -- Se a canônica ainda não tem key=lixo e ninguém usa essa key, padroniza
    IF v_keep.key IS DISTINCT FROM 'lixo'
       AND NOT EXISTS (
         SELECT 1 FROM crm_columns
         WHERE zaploto_id = v_tenant AND key = 'lixo' AND id <> v_keep.id
       )
    THEN
      UPDATE crm_columns SET key = 'lixo', updated_at = now() WHERE id = v_keep.id;
      v_keep.key := 'lixo';
    END IF;

    SELECT * INTO v_keep FROM crm_columns WHERE id = v_keep.id;

    FOR v_dup IN
      SELECT c.*
      FROM crm_columns c
      WHERE c.zaploto_id = v_tenant
        AND c.id <> v_keep.id
        AND (
          c.key = 'lixo'
          OR c.key LIKE 'lixo%'
          OR lower(regexp_replace(coalesce(c.title, ''), '[^a-zA-ZÀ-ÿ0-9]', '', 'g')) = 'lixo'
        )
    LOOP
      WITH updated AS (
        UPDATE crm_lead_stage s
           SET column_id  = v_keep.id,
               column_key = v_keep.key,
               is_manual  = true,
               moved_at   = now(),
               updated_at = now()
         WHERE s.column_id = v_dup.id
            OR s.column_key = v_dup.key
        RETURNING s.lead_external_id, s.user_id
      ),
      hist AS (
        INSERT INTO crm_lead_stage_history (lead_external_id, user_id, from_column_key, to_column_key, moved_by)
        SELECT u.lead_external_id, u.user_id, v_dup.key, v_keep.key, u.user_id
        FROM updated u
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_batch FROM updated;
      v_moved := v_moved + COALESCE(v_batch, 0);

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'crm_tags'
          AND column_name = 'move_to_column_key'
      ) THEN
        EXECUTE format(
          'UPDATE crm_tags SET move_to_column_key = %L WHERE move_to_column_key = %L',
          v_keep.key, v_dup.key
        );
      END IF;

      v_new_key := 'lixo_legado_' || substr(replace(v_dup.id::text, '-', ''), 1, 8);

      UPDATE crm_columns
         SET is_active = false,
             title = 'Lixo (legado)',
             key = CASE
               WHEN key = 'lixo' OR key = v_keep.key THEN v_new_key
               ELSE key
             END,
             updated_at = now()
       WHERE id = v_dup.id;

      RAISE NOTICE 'Tenant % — uniu % → %; % card(s); duplicata desativada.',
        v_tenant, v_dup.key, v_keep.key, COALESCE(v_batch, 0);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Total de cards movidos entre Lixos duplicados: %', v_moved;
END $$;

NOTIFY pgrst, 'reload schema';
