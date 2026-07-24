-- Integra WhatsApp Oficial, Chat e CRM com atribuição auditável.
-- Idempotente e compatível com instalações que aplicaram migrations legadas.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS provider_media_id TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_recovery_status TEXT,
  ADD COLUMN IF NOT EXISTS media_recovery_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chat_messages_provider_media_id
  ON public.chat_messages(provider_media_id)
  WHERE provider_media_id IS NOT NULL;

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gerente_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS chat_conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_scope
  ON public.chat_conversations(workspace_id, gerente_id, user_id, assignment_status);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_lead
  ON public.chat_conversations(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_leads_chat_conversation
  ON public.crm_leads(chat_conversation_id) WHERE chat_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_phone_normalized
  ON public.crm_leads(zaploto_id, regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'));

-- Corrige escopo de conversas oficiais legadas a partir da configuração do número.
UPDATE public.chat_conversations c
SET workspace_id = w.zaploto_id,
    updated_at = now()
FROM public.whatsapp_official_configs w
WHERE c.whatsapp_config_id = w.id
  AND c.workspace_id IS NULL
  AND w.zaploto_id IS NOT NULL;

-- Backfill conservador: vincula somente quando existe exatamente um lead com o mesmo
-- telefone normalizado no tenant. Ambiguidades permanecem para revisão manual.
WITH deterministic AS (
  SELECT c.id AS conversation_id, min(l.id) AS lead_id
  FROM public.chat_conversations c
  JOIN public.crm_leads l
    ON l.zaploto_id = c.workspace_id
   AND regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g') =
       regexp_replace(split_part(c.remote_jid, '@', 1), '[^0-9]', '', 'g')
  WHERE c.lead_id IS NULL AND c.whatsapp_config_id IS NOT NULL
  GROUP BY c.id
  HAVING count(*) = 1
)
UPDATE public.chat_conversations c
SET lead_id = d.lead_id, updated_at = now()
FROM deterministic d
WHERE c.id = d.conversation_id;

UPDATE public.crm_leads l
SET chat_conversation_id = c.id, updated_at = now()
FROM public.chat_conversations c
WHERE c.lead_id = l.id AND l.chat_conversation_id IS NULL;

CREATE TABLE IF NOT EXISTS public.chat_conversation_presence (
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_conversation_presence_recent
  ON public.chat_conversation_presence(conversation_id, last_seen_at DESC);

CREATE OR REPLACE FUNCTION public.chat_assign_conversations(
  p_actor_user_id UUID,
  p_conversation_ids UUID[],
  p_assignee_user_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor profiles%ROWTYPE;
  v_assignee profiles%ROWTYPE;
  v_count INTEGER;
  v_conv RECORD;
  v_column_key TEXT;
BEGIN
  IF COALESCE(array_length(p_conversation_ids, 1), 0) = 0
     OR array_length(p_conversation_ids, 1) > 100 THEN
    RAISE EXCEPTION 'Informe entre 1 e 100 conversas.';
  END IF;

  SELECT * INTO v_actor FROM profiles WHERE id = p_actor_user_id;
  SELECT * INTO v_assignee FROM profiles WHERE id = p_assignee_user_id;
  IF v_actor.id IS NULL OR v_assignee.id IS NULL OR v_assignee.status <> 'captador' THEN
    RAISE EXCEPTION 'Ator ou captador inválido.';
  END IF;
  IF v_assignee.zaploto_id IS DISTINCT FROM v_actor.zaploto_id
     AND v_actor.status <> 'super_admin' THEN
    RAISE EXCEPTION 'Captador pertence a outro tenant.';
  END IF;
  IF v_actor.status = 'gerente' AND v_assignee.enroller IS DISTINCT FROM v_actor.id THEN
    RAISE EXCEPTION 'Captador não pertence a este gerente.';
  END IF;
  IF v_actor.status NOT IN ('super_admin', 'admin', 'gerente') THEN
    RAISE EXCEPTION 'Usuário sem permissão para atribuir.';
  END IF;

  SELECT count(*) INTO v_count
  FROM chat_conversations c
  WHERE c.id = ANY(p_conversation_ids)
    AND (v_actor.status = 'super_admin' OR c.workspace_id = v_actor.zaploto_id)
    AND (
      v_actor.status IN ('super_admin', 'admin')
      OR c.gerente_id IS NULL
      OR c.gerente_id = v_actor.id
    );
  IF v_count <> array_length(p_conversation_ids, 1) THEN
    RAISE EXCEPTION 'Uma ou mais conversas estão fora do seu escopo.';
  END IF;

  SELECT key INTO v_column_key
  FROM crm_columns
  WHERE zaploto_id = v_assignee.zaploto_id AND is_active = true
  ORDER BY sort_order, created_at
  LIMIT 1;
  IF v_column_key IS NULL THEN
    RAISE EXCEPTION 'Tenant sem coluna ativa no CRM.';
  END IF;

  FOR v_conv IN
    UPDATE chat_conversations
       SET user_id = p_assignee_user_id,
           gerente_id = CASE WHEN v_actor.status = 'gerente' THEN v_actor.id ELSE v_assignee.enroller END,
           assigned_by = p_actor_user_id,
           assigned_at = now(),
           assignment_status = 'atribuido',
           attendance_status = 'pendente',
           updated_at = now()
     WHERE id = ANY(p_conversation_ids)
     RETURNING id, lead_id, gerente_id
  LOOP
    IF v_conv.lead_id IS NOT NULL THEN
      UPDATE crm_leads
         SET user_id = p_assignee_user_id,
             gerente_id = v_conv.gerente_id,
             capture_status = 'em_atendimento',
             assigned_by = p_actor_user_id,
             assigned_at = now(),
             updated_at = now()
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
      jsonb_build_object('assigned_by', p_actor_user_id, 'gerente_id', v_conv.gerente_id));
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_assign_conversations(UUID, UUID[], UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
