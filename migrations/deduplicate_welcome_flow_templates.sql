-- =====================================================
-- Migration: Deduplica templates de boas-vindas
-- Data: 2025
-- Descrição: Remove flows duplicados "Boas-vindas (quando entra no grupo)"
--            mantendo apenas o mais antigo por usuário.
--
-- 1. Migra flow_instances dos flows duplicados para o flow mantido (keeper)
--    quando o keeper ainda não tem ativação para aquele (instance, group).
-- 2. Remove flow_instances redundantes (keeper já tem para mesmo instance+group).
-- 3. Deleta os flows duplicados (CASCADE remove flow_instances restantes).
--
-- Executar manualmente após revisar: psql -f migrations/deduplicate_welcome_flow_templates.sql
-- =====================================================

-- Para cada usuário com duplicatas, mantém o mais antigo e remove os demais
DO $$
DECLARE
  rec RECORD;
  keeper_id uuid;
  dup_rec RECORD;
BEGIN
  FOR rec IN
    SELECT user_id, (array_agg(id ORDER BY created_at ASC))[1] AS keeper_id
    FROM flows
    WHERE name = 'Boas-vindas (quando entra no grupo)' AND type = 'template'
    GROUP BY user_id
    HAVING COUNT(*) > 1
  LOOP
    keeper_id := rec.keeper_id;
    
    FOR dup_rec IN
      SELECT id FROM flows
      WHERE user_id = rec.user_id
        AND name = 'Boas-vindas (quando entra no grupo)'
        AND type = 'template'
        AND id != keeper_id
    LOOP
      -- Migra flow_instances do duplicado para o keeper quando não há conflito
      UPDATE flow_instances fi
      SET flow_id = keeper_id, updated_at = now()
      WHERE fi.flow_id = dup_rec.id
        AND NOT EXISTS (
          SELECT 1 FROM flow_instances k
          WHERE k.flow_id = keeper_id
            AND k.instance_name = fi.instance_name
            AND k.group_jid = fi.group_jid
        );
      
      -- Remove flow_instances redundantes (keeper já tem para mesmo instance+group)
      DELETE FROM flow_instances WHERE flow_id = dup_rec.id;
      
      -- Remove o flow duplicado
      DELETE FROM flows WHERE id = dup_rec.id;
      
      RAISE NOTICE 'Removido flow duplicado % (user %)', dup_rec.id, rec.user_id;
    END LOOP;
  END LOOP;
END $$;
