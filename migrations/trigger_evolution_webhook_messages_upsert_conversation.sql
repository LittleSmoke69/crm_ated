-- =====================================================
-- Trigger: evolution_webhook_events (messages.upsert)
--
-- Fluxo:
--   A) Resolve instância Evolution + remote_jid + message_id a partir do payload/colunas.
--   B) Busca conversa existente: (instance_id, remote_jid).
--   C) Se NÃO existir: INSERT em chat_conversations (dados do payload) e obtém conversation_id.
--   D) Se existir: só segue para a mensagem (não recria conversa).
--   E) INSERT em chat_messages com campos extraídos do JSON (dedup por conversation_id + message_id).
--   F) Se a mensagem for nova: atualiza resumo da conversa; recebidas incrementam não lidas.
--
-- Depende: evolution_webhook_events, evolution_instances, chat_conversations, chat_messages,
-- idx_chat_conversations_instance_remote, idx_chat_messages_conversation_message,
-- increment_unread_count(uuid).
-- =====================================================

CREATE OR REPLACE FUNCTION public.trg_evolution_webhook_events_messages_upsert_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_event text;
  v_instance_id uuid;
  v_workspace_id uuid;
  v_user_id uuid;
  v_remote_jid text;
  v_instance_name text;
  v_push text;
  v_title text;
  v_preview text;
  v_text text;
  v_caption text;
  v_ts bigint;
  v_last_at timestamptz;
  v_from_me boolean;
  v_is_group boolean;
  v_conv_id uuid;
  v_message_id text;
  v_sender_jid text;
  v_participant text;
  v_media_type text;
  v_msg jsonb;
  v_ins int;
  v_payload_status text;
  v_message_status text;
  v_message_type_hint text;
  v_media_url text;
BEGIN
  -- ── Evento e payload ─────────────────────────────────────────────
  IF NEW.payload IS NULL THEN
    RETURN NEW;
  END IF;

  v_norm_event := lower(replace(replace(trim(NEW.event_type), '_', '.'), '-', '.'));

  IF v_norm_event IS DISTINCT FROM 'messages.upsert' THEN
    RETURN NEW;
  END IF;

  v_remote_jid := coalesce(
    nullif(trim(NEW.remote_jid), ''),
    nullif(trim(NEW.payload #>> '{data,key,remoteJid}'), ''),
    nullif(trim(NEW.payload #>> '{data,key,remoteJidAlt}'), ''),
    nullif(trim(NEW.payload #>> '{data,message,key,remoteJid}'), '')
  );

  IF v_remote_jid IS NULL OR length(v_remote_jid) = 0 THEN
    RETURN NEW;
  END IF;

  IF v_remote_jid LIKE '%status@broadcast%' THEN
    RETURN NEW;
  END IF;

  v_instance_name := coalesce(
    nullif(trim(NEW.instance_name), ''),
    nullif(trim(NEW.payload #>> '{instance}'), ''),
    nullif(trim(NEW.payload #>> '{instanceName}'), '')
  );

  IF v_instance_name IS NULL OR length(v_instance_name) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT ei.id, ei.workspace_id, ei.user_id
  INTO v_instance_id, v_workspace_id, v_user_id
  FROM evolution_instances ei
  WHERE ei.instance_name = v_instance_name
    AND (ei.is_chat_instance IS TRUE OR ei.is_master IS TRUE)
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_message_id := coalesce(
    nullif(trim(NEW.message_id), ''),
    nullif(trim(NEW.payload #>> '{data,key,id}'), ''),
    nullif(trim(NEW.payload #>> '{data,message,key,id}'), '')
  );

  IF v_message_id IS NULL OR length(v_message_id) = 0 THEN
    RETURN NEW;
  END IF;

  -- ── Campos derivados do payload (data.*) ─────────────────────────
  v_push := nullif(trim(NEW.payload #>> '{data,pushName}'), '');

  v_from_me := coalesce(
    CASE lower(nullif(trim(NEW.payload #>> '{data,key,fromMe}'), ''))
      WHEN 'true' THEN true
      WHEN 't' THEN true
      WHEN '1' THEN true
      WHEN 'false' THEN false
      WHEN 'f' THEN false
      WHEN '0' THEN false
      ELSE null
    END,
    false
  );

  v_participant := nullif(trim(NEW.payload #>> '{data,key,participant}'), '');
  v_sender_jid := coalesce(
    v_participant,
    v_remote_jid,
    nullif(trim(NEW.payload #>> '{sender}'), '')
  );

  v_ts := coalesce(
    (nullif(trim(NEW.payload #>> '{data,messageTimestamp}'), ''))::bigint,
    extract(epoch from now())::bigint
  );
  v_last_at := 'epoch'::timestamptz + (v_ts * interval '1 second');

  v_payload_status := upper(nullif(trim(NEW.payload #>> '{data,status}'), ''));

  v_message_status := CASE
    WHEN v_from_me THEN 'sent'
    WHEN v_payload_status IN ('DELIVERY_ACK', 'DELIVERED', 'DELIVERED_ACK') THEN 'delivered'
    WHEN v_payload_status IN ('READ', 'READ_ACK', 'PLAYED') THEN 'read'
    WHEN v_payload_status IN ('PENDING', 'SERVER_ACK') THEN 'received'
    ELSE 'received'
  END;

  v_msg := coalesce(NEW.payload #> '{data,message}', '{}'::jsonb);

  v_text := coalesce(
    nullif(trim(v_msg #>> '{conversation}'), ''),
    nullif(trim(v_msg #>> '{extendedTextMessage,text}'), ''),
    nullif(trim(v_msg #>> '{imageMessage,caption}'), ''),
    nullif(trim(v_msg #>> '{videoMessage,caption}'), ''),
    nullif(trim(v_msg #>> '{documentMessage,caption}'), ''),
    nullif(trim(v_msg #>> '{message,conversation}'), ''),
    nullif(trim(v_msg #>> '{buttonsResponseMessage,selectedDisplayText}'), ''),
    nullif(trim(v_msg #>> '{listResponseMessage,title}'), ''),
    nullif(trim(v_msg #>> '{listResponseMessage,singleSelectReply,selectedRowId}'), ''),
    nullif(trim(v_msg #>> '{locationMessage,name}'), ''),
    nullif(trim(v_msg #>> '{contactMessage,displayName}'), ''),
    nullif(trim(v_msg #>> '{reactionMessage,text}'), ''),
    ''
  );

  v_caption := coalesce(
    nullif(trim(v_msg #>> '{imageMessage,caption}'), ''),
    nullif(trim(v_msg #>> '{videoMessage,caption}'), ''),
    nullif(trim(v_msg #>> '{documentMessage,caption}'), ''),
    ''
  );

  v_preview := left(v_text, 100);

  v_title := coalesce(v_push, split_part(v_remote_jid, '@', 1), v_remote_jid);
  v_is_group := v_remote_jid LIKE '%@g.us';

  v_media_type := CASE
    WHEN v_msg ? 'imageMessage' THEN 'image'
    WHEN v_msg ? 'videoMessage' THEN 'video'
    WHEN v_msg ? 'audioMessage' THEN 'audio'
    WHEN v_msg ? 'documentMessage' THEN 'document'
    WHEN v_msg ? 'stickerMessage' THEN 'image'
    WHEN v_msg ? 'locationMessage' THEN 'text'
    WHEN v_msg ? 'contactMessage' THEN 'text'
    WHEN v_msg ? 'buttonsResponseMessage' THEN 'text'
    WHEN v_msg ? 'listResponseMessage' THEN 'text'
    WHEN v_msg ? 'reactionMessage' THEN 'text'
    ELSE 'text'
  END;

  v_message_type_hint := lower(nullif(trim(NEW.payload #>> '{data,messageType}'), ''));

  IF v_message_type_hint IS NOT NULL THEN
    v_media_type := CASE v_message_type_hint
      WHEN 'conversation' THEN 'text'
      WHEN 'extendedtextmessage' THEN 'text'
      WHEN 'imagemessage' THEN 'image'
      WHEN 'videomessage' THEN 'video'
      WHEN 'audiomessage' THEN 'audio'
      WHEN 'documentmessage' THEN 'document'
      WHEN 'stickermessage' THEN 'image'
      ELSE v_media_type
    END;
  END IF;

  v_media_url := coalesce(
    nullif(trim(v_msg #>> '{imageMessage,url}'), ''),
    nullif(trim(v_msg #>> '{videoMessage,url}'), ''),
    nullif(trim(v_msg #>> '{audioMessage,url}'), ''),
    nullif(trim(v_msg #>> '{documentMessage,url}'), ''),
    nullif(trim(v_msg #>> '{stickerMessage,url}'), '')
  );

  -- ── B) Conversa já existe? ───────────────────────────────────────
  SELECT cc.id
  INTO v_conv_id
  FROM chat_conversations cc
  WHERE cc.instance_id = v_instance_id
    AND cc.remote_jid = v_remote_jid
  LIMIT 1;

  -- ── C) Sem conversa: cria com dados do webhook ───────────────────
  IF v_conv_id IS NULL THEN
    INSERT INTO public.chat_conversations (
      instance_id,
      workspace_id,
      user_id,
      remote_jid,
      title,
      is_group,
      last_message_at,
      last_message_preview,
      last_customer_message_at,
      unread_count
    ) VALUES (
      v_instance_id,
      v_workspace_id,
      v_user_id,
      v_remote_jid,
      v_title,
      v_is_group,
      v_last_at,
      nullif(v_preview, ''),
      CASE WHEN NOT v_from_me THEN v_last_at ELSE NULL END,
      0
    )
    ON CONFLICT (instance_id, remote_jid) WHERE instance_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
      SELECT cc.id
      INTO v_conv_id
      FROM chat_conversations cc
      WHERE cc.instance_id = v_instance_id
        AND cc.remote_jid = v_remote_jid
      LIMIT 1;
    END IF;
  END IF;

  -- D) Com conversa (nova ou existente): grava mensagem ─────────────
  IF v_conv_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_messages (
    instance_id,
    workspace_id,
    user_id,
    conversation_id,
    message_id,
    direction,
    from_me,
    sender_jid,
    text,
    media_type,
    media_url,
    caption,
    status,
    timestamp,
    provider
  ) VALUES (
    v_instance_id,
    v_workspace_id,
    v_user_id,
    v_conv_id,
    v_message_id,
    CASE WHEN v_from_me THEN 'out' ELSE 'in' END,
    v_from_me,
    v_sender_jid,
    nullif(v_text, ''),
    v_media_type,
    nullif(v_media_url, ''),
    nullif(v_caption, ''),
    v_message_status,
    v_ts,
    'evolution'
  )
  ON CONFLICT (conversation_id, message_id)
  DO NOTHING;

  GET DIAGNOSTICS v_ins = ROW_COUNT;

  IF v_ins > 0 THEN
    UPDATE public.chat_conversations c
    SET
      last_message_at = v_last_at,
      last_message_preview = coalesce(nullif(v_preview, ''), c.last_message_preview),
      last_customer_message_at = CASE
        WHEN NOT v_from_me THEN v_last_at
        ELSE c.last_customer_message_at
      END
    WHERE c.id = v_conv_id;

    IF NOT v_from_me THEN
      PERFORM public.increment_unread_count(v_conv_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_evolution_webhook_events_messages_upsert_conversation() IS
  'messages.upsert: cria conversa se necessário; sempre tenta inserir chat_messages a partir do payload; atualiza resumo.';

DROP TRIGGER IF EXISTS trg_evo_webhook_messages_upsert_conversation ON public.evolution_webhook_events;

CREATE TRIGGER trg_evo_webhook_messages_upsert_conversation
  AFTER INSERT OR UPDATE OF event_type, payload, remote_jid, instance_name, message_id
  ON public.evolution_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_evolution_webhook_events_messages_upsert_conversation();
