-- =====================================================
-- Enriquecimento de media_url para mensagens Evolution (messages.upsert)
-- 1) Tenta salvar mídia via Edge Function (Storage Supabase) e usar publicUrl
-- 2) Se falhar, faz fallback local (url, directPath+server_url, base64 image)
-- =====================================================

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.trg_evo_webhook_messages_upsert_media_url_fallback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_event text;
  v_instance_name text;
  v_instance_id uuid;
  v_message_id text;
  v_media_url text;
  v_direct_path text;
  v_server_url text;
  v_base64 text;
  v_mime text;
  v_is_image boolean;
  v_media_type text;
  v_function_url text := 'https://zlhoswwvoftcpfayrtsq.supabase.co/functions/v1/smart-task';
  v_function_key text := 'sb_publishable_p3dL76IIDqtN5yYNoPjttQ_fvWMeXmb';
  v_request_body jsonb;
  v_http_resp record;
  v_http_content jsonb;
  v_saved_url text;
  v_mime_clean text;
BEGIN
  IF NEW.payload IS NULL THEN
    RETURN NEW;
  END IF;

  v_norm_event := lower(replace(replace(trim(NEW.event_type), '_', '.'), '-', '.'));
  IF v_norm_event IS DISTINCT FROM 'messages.upsert' THEN
    RETURN NEW;
  END IF;

  v_instance_name := coalesce(
    nullif(trim(NEW.instance_name), ''),
    nullif(trim(NEW.payload #>> '{instance}'), ''),
    nullif(trim(NEW.payload #>> '{instanceName}'), '')
  );
  IF v_instance_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ei.id
    INTO v_instance_id
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
  IF v_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_media_type := CASE
    WHEN (NEW.payload #> '{data,message,imageMessage}') IS NOT NULL THEN 'imageMessage'
    WHEN (NEW.payload #> '{data,message,videoMessage}') IS NOT NULL THEN 'videoMessage'
    WHEN (NEW.payload #> '{data,message,audioMessage}') IS NOT NULL THEN 'audioMessage'
    WHEN (NEW.payload #> '{data,message,documentMessage}') IS NOT NULL THEN 'documentMessage'
    WHEN (NEW.payload #> '{data,message,stickerMessage}') IS NOT NULL THEN 'stickerMessage'
    ELSE NULL
  END;

  v_media_url := coalesce(
    nullif(trim(NEW.payload #>> '{data,message,imageMessage,url}'), ''),
    nullif(trim(NEW.payload #>> '{data,message,videoMessage,url}'), ''),
    nullif(trim(NEW.payload #>> '{data,message,audioMessage,url}'), ''),
    nullif(trim(NEW.payload #>> '{data,message,documentMessage,url}'), ''),
    nullif(trim(NEW.payload #>> '{data,message,stickerMessage,url}'), '')
  );

  -- 1) Chama Edge Function para salvar a mídia no Storage e retornar URL pública
  IF v_media_type IS NOT NULL AND (v_media_url IS NOT NULL OR (NEW.payload #>> '{data,message,base64}') IS NOT NULL) THEN
    v_mime_clean := lower(split_part(coalesce(
      nullif(trim(NEW.payload #>> '{data,message,imageMessage,mimetype}'), ''),
      nullif(trim(NEW.payload #>> '{data,message,videoMessage,mimetype}'), ''),
      nullif(trim(NEW.payload #>> '{data,message,audioMessage,mimetype}'), ''),
      nullif(trim(NEW.payload #>> '{data,message,documentMessage,mimetype}'), ''),
      'application/octet-stream'
    ), ';', 1));

    v_request_body := jsonb_build_object(
      'sourceUrl', v_media_url,
      'sourceBase64', nullif(trim(NEW.payload #>> '{data,message,base64}'), ''),
      'mimeType', v_mime_clean,
      'instanceName', v_instance_name,
      'messageId', v_message_id,
      'mediaType', v_media_type
    );

    BEGIN
      SELECT *
        INTO v_http_resp
      FROM extensions.http(
        (
          'POST',
          v_function_url,
          ARRAY[
            extensions.http_header('Authorization', 'Bearer ' || v_function_key),
            extensions.http_header('apikey', v_function_key)
          ],
          'application/json',
          v_request_body::text
        )::extensions.http_request
      );

      IF v_http_resp.status BETWEEN 200 AND 299 THEN
        v_http_content := nullif(v_http_resp.content, '')::jsonb;
        v_saved_url := coalesce(
          nullif(trim(v_http_content ->> 'publicUrl'), ''),
          nullif(trim(v_http_content ->> 'public_url'), ''),
          nullif(trim(v_http_content ->> 'url'), ''),
          nullif(trim(v_http_content #>> '{data,publicUrl}'), ''),
          nullif(trim(v_http_content #>> '{data,public_url}'), ''),
          nullif(trim(v_http_content #>> '{data,url}'), '')
        );
        IF v_saved_url IS NOT NULL THEN
          v_media_url := v_saved_url;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Mantém fallback local abaixo se chamada HTTP falhar
      NULL;
    END;
  END IF;

  -- 2) Fallback local
  IF v_media_url IS NULL THEN
    v_direct_path := coalesce(
      nullif(trim(NEW.payload #>> '{data,message,imageMessage,directPath}'), ''),
      nullif(trim(NEW.payload #>> '{data,message,videoMessage,directPath}'), ''),
      nullif(trim(NEW.payload #>> '{data,message,audioMessage,directPath}'), ''),
      nullif(trim(NEW.payload #>> '{data,message,documentMessage,directPath}'), ''),
      nullif(trim(NEW.payload #>> '{data,message,stickerMessage,directPath}'), '')
    );
    v_server_url := nullif(trim(NEW.payload #>> '{server_url}'), '');

    IF v_server_url IS NOT NULL AND v_direct_path IS NOT NULL THEN
      v_media_url := rtrim(v_server_url, '/') || '/' || ltrim(v_direct_path, '/');
    END IF;
  END IF;

  v_is_image := (NEW.payload #> '{data,message,imageMessage}') IS NOT NULL;
  IF v_media_url IS NULL AND v_is_image THEN
    v_base64 := nullif(trim(NEW.payload #>> '{data,message,base64}'), '');
    v_mime := coalesce(
      nullif(trim(NEW.payload #>> '{data,message,imageMessage,mimetype}'), ''),
      'image/jpeg'
    );
    IF v_base64 IS NOT NULL THEN
      v_media_url := 'data:' || v_mime || ';base64,' || v_base64;
    END IF;
  END IF;

  IF v_media_url IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE chat_messages cm
     SET media_url = v_media_url
   WHERE cm.instance_id = v_instance_id
     AND cm.message_id = v_message_id
     AND cm.provider = 'evolution'
     AND (
       cm.media_url IS NULL
       OR cm.media_url = ''
       OR cm.media_url <> v_media_url
     );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evo_webhook_messages_upsert_media_url_fallback ON public.evolution_webhook_events;

CREATE TRIGGER trg_evo_webhook_messages_upsert_media_url_fallback
  AFTER INSERT OR UPDATE OF event_type, payload, instance_name, message_id
  ON public.evolution_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_evo_webhook_messages_upsert_media_url_fallback();

