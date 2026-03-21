-- ==============================================================================
-- ROLLBACK: Transferência com count=0 do CRM marcou entries incorretamente
--
-- Contexto:
--   O CRM retornou success=true mas count=0 na redistribuição de leads.
--   O sistema incorretamente:
--     1. Inseriu um novo audit log (admin_lead_transfer_logs) com count=0
--     2. Inseriu 100 admin_lead_transfer_entries no novo log
--     3. Marcou 100 entries do log de origem como 'repassado'
--
-- Banca: 4a844612-bb4e-4e9e-bcb7-95149d9d6590
-- Origem: laianecs97@gmail.com → Destino: brenominowa2@yahoo.com
-- Log de origem: 5a3a8e66-ab8f-47e0-957f-a4dedf1dd73f
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  bad_log_id UUID;
  deleted_entries INT;
  reverted_entries INT;
BEGIN
  -- Passo 1: Encontrar o log incorreto (count=0, TF2, mesma banca+emails, recente)
  SELECT id INTO bad_log_id
  FROM admin_lead_transfer_logs
  WHERE banca_id = '4a844612-bb4e-4e9e-bcb7-95149d9d6590'
    AND source_consultant_email = 'laianecs97@gmail.com'
    AND target_consultant_email = 'brenominowa2@yahoo.com'
    AND count = 0
    AND transfer_type = 'TF2'
    AND created_at >= NOW() - INTERVAL '2 hours'
  ORDER BY created_at DESC
  LIMIT 1;

  IF bad_log_id IS NULL THEN
    RAISE NOTICE 'Nenhum log incorreto encontrado. Nada a fazer.';
  ELSE
    RAISE NOTICE 'Log incorreto encontrado: %', bad_log_id;

    -- Passo 2: Deletar as entries do log incorreto
    DELETE FROM admin_lead_transfer_entries
    WHERE transfer_log_id = bad_log_id
      AND banca_id = '4a844612-bb4e-4e9e-bcb7-95149d9d6590';

    GET DIAGNOSTICS deleted_entries = ROW_COUNT;
    RAISE NOTICE 'Entries deletadas do log incorreto (%): %', bad_log_id, deleted_entries;

    -- Passo 3: Deletar o log incorreto
    DELETE FROM admin_lead_transfer_logs WHERE id = bad_log_id;
    RAISE NOTICE 'Log incorreto deletado: %', bad_log_id;
  END IF;

  -- Passo 4: Reverter entries do log de origem de 'repassado' para 'disponivel_retransferencia'
  UPDATE admin_lead_transfer_entries
  SET
    resolution_status = 'disponivel_retransferencia',
    resolved_at       = NULL
  WHERE transfer_log_id = '5a3a8e66-ab8f-47e0-957f-a4dedf1dd73f'
    AND banca_id        = '4a844612-bb4e-4e9e-bcb7-95149d9d6590'
    AND resolution_status = 'repassado'
    AND resolved_at >= NOW() - INTERVAL '2 hours';

  GET DIAGNOSTICS reverted_entries = ROW_COUNT;
  RAISE NOTICE 'Entries do log de origem revertidas para disponivel_retransferencia: %', reverted_entries;
END $$;

COMMIT;
