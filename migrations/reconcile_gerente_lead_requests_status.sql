-- =====================================================
-- Migration: Reconcilia status de solicitações de leads pendentes/parciais
-- Data: 2026-03-20
-- Descrição: Atualiza gerente_lead_requests.status para 'approved' ou 'partial'
--            quando existem transferências reais em admin_lead_transfer_logs
--            com filters_snapshot->>'from_solicitation' = id da solicitação.
--            Cobre casos onde o UPDATE de status falhou após as transferências.
-- =====================================================

DO $$
DECLARE
  rec RECORD;
  actual_count INT;
  total_requested INT;
  new_status TEXT;
  log_ids TEXT[];
BEGIN
  FOR rec IN
    SELECT r.id, r.consultores, r.banca_id, r.status, r.approval_snapshot
    FROM gerente_lead_requests r
    WHERE r.status IN ('pending', 'partial')
  LOOP
    -- Total de leads solicitados
    SELECT COALESCE(SUM((c->>'quantity')::int), 0) INTO total_requested
    FROM jsonb_array_elements(rec.consultores::jsonb) c;

    IF total_requested = 0 THEN CONTINUE; END IF;

    -- IDs dos logs vinculados a esta solicitação via filters_snapshot
    SELECT array_agg(atl.id::text) INTO log_ids
    FROM admin_lead_transfer_logs atl
    WHERE atl.banca_id = rec.banca_id
      AND (atl.filters_snapshot->>'from_solicitation') = rec.id::text;

    IF log_ids IS NULL OR array_length(log_ids, 1) = 0 THEN CONTINUE; END IF;

    -- Conta leads realmente transferidos (exclui devolvido e reversed)
    SELECT COUNT(ae.id) INTO actual_count
    FROM admin_lead_transfer_entries ae
    WHERE ae.transfer_log_id = ANY(log_ids::uuid[])
      AND (ae.resolution_status IS NULL
           OR ae.resolution_status NOT IN ('devolvido', 'reversed'));

    IF actual_count = 0 THEN CONTINUE; END IF;

    IF actual_count >= total_requested THEN
      new_status := 'approved';
    ELSE
      new_status := 'partial';
    END IF;

    IF new_status = rec.status THEN CONTINUE; END IF;

    UPDATE gerente_lead_requests
    SET
      status = new_status,
      approval_snapshot = jsonb_set(
        COALESCE(rec.approval_snapshot, '{}'),
        '{total_leads_transferred}',
        to_jsonb(actual_count)
      )
    WHERE id = rec.id;

    RAISE NOTICE 'Reconciliado: solicitação % → % (% de % leads transferidos, logs: %)',
      rec.id, new_status, actual_count, total_requested, array_to_string(log_ids, ',');
  END LOOP;

  RAISE NOTICE 'Reconciliação de gerente_lead_requests concluída.';
END $$;
