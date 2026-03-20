-- =====================================================
-- Trigger: ao inserir/atualizar evolution_webhook_events com evento de envio,
-- marca a mensagem de saída correspondente em chat_messages como enviada.
--
-- Requisito: eventos de produção/teste gravados em evolution_webhook_events
-- (ex.: POST /api/webhooks/evolution/prod|test).
--
-- event_type aceitos (case-insensitive, _ ou .):
--   send.message, SEND_MESSAGE, send_message, etc. → normalizado para comparar com send.message
--
-- Coluna status: usa 'sent' (padrão do app / chat-atendimento). Evite 'sended' para não quebrar a UI.
-- =====================================================

CREATE OR REPLACE FUNCTION public.trg_evolution_webhook_events_chat_send_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_event text;
  v_instance_id uuid;
  v_mid text;
  v_remote_jid text;
  v_updated int;
BEGIN
  v_norm_event := lower(replace(replace(trim(NEW.event_type), '_', '.'), '-', '.'));

  IF v_norm_event IS DISTINCT FROM 'send.message' THEN
    RETURN NEW;
  END IF;

  IF NEW.instance_name IS NULL OR length(trim(NEW.instance_name)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT ei.id
  INTO v_instance_id
  FROM evolution_instances ei
  WHERE ei.instance_name = NEW.instance_name
    AND (ei.is_chat_instance IS TRUE OR ei.is_master IS TRUE)
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_mid := NULLIF(trim(NEW.message_id), '');

  IF (v_mid IS NULL OR length(v_mid) = 0) AND NEW.payload IS NOT NULL THEN
    v_mid := coalesce(
      NEW.payload #>> '{data,key,id}',
      NEW.payload #>> '{data,message,key,id}',
      NEW.payload #>> '{key,id}',
      NEW.payload #>> '{data,id}'
    );
    v_mid := NULLIF(trim(v_mid), '');
  END IF;

  v_remote_jid := NULLIF(trim(NEW.remote_jid), '');

  IF v_remote_jid IS NULL AND NEW.payload IS NOT NULL THEN
    v_remote_jid := coalesce(
      NEW.payload #>> '{data,key,remoteJid}',
      NEW.payload #>> '{data,message,key,remoteJid}',
      NEW.payload #>> '{key,remoteJid}'
    );
    v_remote_jid := NULLIF(trim(v_remote_jid), '');
  END IF;

  IF v_mid IS NOT NULL THEN
    UPDATE chat_messages cm
    SET status = 'sent'
    WHERE cm.instance_id = v_instance_id
      AND cm.message_id = v_mid
      AND cm.direction = 'out'
      AND cm.from_me IS TRUE
      AND cm.status = 'pending';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Fallback: última mensagem de saída pendente do contato (precisa remote_jid)
  IF v_remote_jid IS NOT NULL THEN
    UPDATE chat_messages cm
    SET status = 'sent'
    FROM (
      SELECT cm2.id
      FROM chat_messages cm2
      INNER JOIN chat_conversations cc ON cc.id = cm2.conversation_id
      WHERE cc.instance_id = v_instance_id
        AND cc.remote_jid = v_remote_jid
        AND cm2.from_me IS TRUE
        AND cm2.direction = 'out'
        AND cm2.status = 'pending'
      ORDER BY cm2.timestamp DESC NULLS LAST, cm2.created_at DESC NULLS LAST
      LIMIT 1
    ) AS t
    WHERE cm.id = t.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_evolution_webhook_events_chat_send_status() IS
  'Marca chat_messages (out/pending) como sent quando evolution_webhook_events recebe send.message.';

DROP TRIGGER IF EXISTS trg_evo_webhook_chat_send_status ON public.evolution_webhook_events;

CREATE TRIGGER trg_evo_webhook_chat_send_status
  AFTER INSERT OR UPDATE OF event_type, message_id, payload, remote_jid, instance_name
  ON public.evolution_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_evolution_webhook_events_chat_send_status();
