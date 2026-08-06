-- Corrige atribuição no chat de atendimento:
-- 1) Escopo aceita workspace da conversa OU da instância Evolution / WhatsApp Oficial
--    (conversas com workspace_id NULL deixavam de atribuir com "fora do seu escopo").
-- 2) Não exige gerente/captador online (last_seen / presence) — offline pode receber lead.
-- 3) Ao atribuir, preenche workspace_id nulo com o tenant efetivo.

CREATE OR REPLACE FUNCTION public.chat_assign_conversations(
  p_actor_user_id UUID, p_conversation_ids UUID[], p_assignee_user_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor profiles%ROWTYPE;
  v_assignee profiles%ROWTYPE;
  v_count INTEGER;
  v_conv RECORD;
  v_column_key TEXT;
  v_delegating_to_gerente BOOLEAN;
BEGIN
  IF COALESCE(array_length(p_conversation_ids, 1), 0) = 0
     OR array_length(p_conversation_ids, 1) > 100 THEN
    RAISE EXCEPTION 'Informe entre 1 e 100 conversas.';
  END IF;

  SELECT * INTO v_actor FROM profiles WHERE id = p_actor_user_id;
  SELECT * INTO v_assignee FROM profiles WHERE id = p_assignee_user_id;
  IF v_actor.id IS NULL OR v_assignee.id IS NULL THEN
    RAISE EXCEPTION 'Ator ou destinatário inválido.';
  END IF;
  IF v_actor.status NOT IN ('super_admin', 'admin', 'gerente') THEN
    RAISE EXCEPTION 'Usuário sem permissão para atribuir.';
  END IF;

  v_delegating_to_gerente := v_actor.status IN ('super_admin', 'admin');
  IF v_delegating_to_gerente AND v_assignee.status <> 'gerente' THEN
    RAISE EXCEPTION 'Administradores só podem atribuir a um gerente; o gerente repassa ao captador do time dele.';
  END IF;
  IF v_actor.status = 'gerente' AND v_assignee.status <> 'captador' THEN
    RAISE EXCEPTION 'Gerente só pode atribuir a um captador.';
  END IF;
  IF v_actor.status = 'gerente' AND v_assignee.enroller IS DISTINCT FROM v_actor.id THEN
    RAISE EXCEPTION 'Captador não pertence a este gerente.';
  END IF;
  IF v_assignee.zaploto_id IS DISTINCT FROM v_actor.zaploto_id
     AND v_actor.status <> 'super_admin' THEN
    RAISE EXCEPTION 'Destinatário pertence a outro tenant.';
  END IF;

  -- Backfill workspace nulo a partir do canal (Evolution / WhatsApp Oficial).
  UPDATE chat_conversations c
     SET workspace_id = COALESCE(
           c.workspace_id,
           (SELECT ei.workspace_id FROM evolution_instances ei WHERE ei.id = c.instance_id),
           (SELECT w.zaploto_id FROM whatsapp_official_configs w WHERE w.id = c.whatsapp_config_id),
           v_actor.zaploto_id
         ),
         updated_at = now()
   WHERE c.id = ANY(p_conversation_ids)
     AND c.workspace_id IS NULL;

  SELECT count(*) INTO v_count
  FROM chat_conversations c
  LEFT JOIN evolution_instances ei ON ei.id = c.instance_id
  LEFT JOIN whatsapp_official_configs w ON w.id = c.whatsapp_config_id
  WHERE c.id = ANY(p_conversation_ids)
    AND (
      v_actor.status = 'super_admin'
      OR COALESCE(c.workspace_id, ei.workspace_id, w.zaploto_id) = v_actor.zaploto_id
    )
    AND (
      v_actor.status IN ('super_admin', 'admin')
      OR c.gerente_id IS NULL
      OR c.gerente_id = v_actor.id
    );
  IF v_count <> array_length(p_conversation_ids, 1) THEN
    RAISE EXCEPTION 'Uma ou mais conversas estão fora do seu escopo.';
  END IF;

  IF v_delegating_to_gerente THEN
    UPDATE chat_conversations
       SET user_id = NULL, gerente_id = p_assignee_user_id,
           assigned_by = p_actor_user_id, assigned_at = now(),
           assignment_status = 'atribuido', attendance_status = 'pendente', updated_at = now()
     WHERE id = ANY(p_conversation_ids);

    UPDATE crm_leads l
       SET user_id = NULL, gerente_id = p_assignee_user_id,
           capture_status = 'pendente', assigned_by = p_actor_user_id,
           assigned_at = now(), updated_at = now()
      FROM chat_conversations c
     WHERE c.id = ANY(p_conversation_ids) AND c.lead_id = l.id;

    INSERT INTO chat_attendance_events(conversation_id, agent_user_id, event_type, meta)
    SELECT id, p_assignee_user_id, 'transferred',
           jsonb_build_object('assigned_by', p_actor_user_id, 'gerente_id', p_assignee_user_id, 'allow_offline', true)
      FROM chat_conversations WHERE id = ANY(p_conversation_ids);
    RETURN v_count;
  END IF;

  SELECT key INTO v_column_key FROM crm_columns
   WHERE zaploto_id = v_assignee.zaploto_id AND is_active = true
   ORDER BY sort_order, created_at LIMIT 1;
  IF v_column_key IS NULL THEN
    RAISE EXCEPTION 'Tenant sem coluna ativa no CRM.';
  END IF;

  FOR v_conv IN
    UPDATE chat_conversations
       SET user_id = p_assignee_user_id, gerente_id = v_actor.id,
           assigned_by = p_actor_user_id, assigned_at = now(),
           assignment_status = 'atribuido', attendance_status = 'pendente', updated_at = now()
     WHERE id = ANY(p_conversation_ids)
     RETURNING id, lead_id, gerente_id
  LOOP
    IF v_conv.lead_id IS NOT NULL THEN
      UPDATE crm_leads
         SET user_id = p_assignee_user_id, gerente_id = v_conv.gerente_id,
             capture_status = 'em_atendimento', assigned_by = p_actor_user_id,
             assigned_at = now(), updated_at = now()
       WHERE id = v_conv.lead_id;

      DELETE FROM crm_lead_stage
       WHERE lead_external_id = (SELECT external_id::text FROM crm_leads WHERE id = v_conv.lead_id)
         AND user_id <> p_assignee_user_id;

      PERFORM crm_move_lead(
        (SELECT external_id::text FROM crm_leads WHERE id = v_conv.lead_id),
        p_assignee_user_id, v_column_key, 0, p_actor_user_id
      );
    END IF;

    INSERT INTO chat_attendance_events(conversation_id, agent_user_id, event_type, meta)
    VALUES (v_conv.id, p_assignee_user_id, 'assigned',
      jsonb_build_object('assigned_by', p_actor_user_id, 'gerente_id', v_conv.gerente_id, 'allow_offline', true));
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_assign_conversations(UUID, UUID[], UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
