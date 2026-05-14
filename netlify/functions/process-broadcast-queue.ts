/**
 * Worker: fila de disparo em massa (chat_broadcasts status running).
 *
 * Agendamento em produção: crontab na VPS (`npm run cron:run -- process-broadcast-queue`),
 * ver `scripts/linux/scheduled-jobs.ts` e `install-linux-cron.ts`. O fonte permanece em
 * `netlify/functions/` apenas como pasta de handlers reutilizáveis pelo runner.
 *
 * Fluxo por broadcast:
 * 1. Verifica se já passou delay_seconds desde last_sent_at
 * 2. Escolhe instância(s) da rotação; se uma cair, tenta as outras ativas antes de pausar
 * 3. Envia mensagem via Evolution API
 * 4. Persiste conversa e mensagem no chat (realtime)
 * 5. Avança current_index e atualiza last_sent_at
 * 6. Repete até acabar o tempo do worker (~20s) ou o delay impedir
 */

import { createClient } from '@supabase/supabase-js';
import { maybeMarkEvolutionInstanceDisconnected } from '../../lib/evolution/mark-instance-disconnected';
import { broadcastSendErrorIsInstanceUnreachable, orderedBroadcastInstanceIds } from '../../lib/chat/broadcast-instance-failover';
import { computeNextDelaySeconds } from '../../lib/chat/broadcast-delay';
import { getSequenceDelaySeconds, parseBroadcastSteps } from '../../lib/chat/broadcast-sequence';
import { coerceEvolutionSendMediaFields } from '../../lib/crm/evolution-send-media-meta';

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const WORKER_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 30_000;

function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const withCountry =
    !digits.startsWith('55') && (digits.length === 10 || digits.length === 11)
      ? `55${digits}`
      : digits;
  return `${withCountry}@s.whatsapp.net`;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

async function sendEvolutionMessage(
  baseUrl: string,
  instanceName: string,
  apikey: string,
  remoteJid: string,
  msgConfig: { type: string; content?: string; attachment_url?: string; mimetype?: string; caption?: string; fileName?: string },
): Promise<Record<string, unknown>> {
  const number = remoteJid.replace(/@s\.whatsapp\.net$/i, '');
  let endpoint: string;
  let body: Record<string, unknown> = { number };
  let fallbackEndpoint: string | null = null;

  if (msgConfig.type === 'text') {
    endpoint = `${baseUrl}/message/sendText/${instanceName}`;
    body.text = msgConfig.content;
  } else if (msgConfig.type === 'audio') {
    endpoint = `${baseUrl}/message/sendWhatsAppAudio/${instanceName}`;
    fallbackEndpoint = `${baseUrl}/message/sendAudio/${instanceName}`;
    body.audio = msgConfig.attachment_url;
  } else {
    const coerced = coerceEvolutionSendMediaFields({
      mediatype: msgConfig.type,
      mimetype: msgConfig.mimetype,
      fileName: msgConfig.fileName,
      mediaUrl: msgConfig.attachment_url,
    });
    endpoint = `${baseUrl}/message/sendMedia/${instanceName}`;
    body = {
      ...body,
      media: msgConfig.attachment_url,
      mediatype: coerced.mediatype,
      mimetype: coerced.mimetype,
      caption: msgConfig.caption,
      fileName: coerced.fileName,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  const doRequest = async (url: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

  try {
    let response = await doRequest(endpoint);
    if (!response.ok && fallbackEndpoint && (response.status === 404 || response.status === 405)) {
      response = await doRequest(fallbackEndpoint);
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Evolution ${response.status}: ${text.substring(0, 200)}`);
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function processOneBroadcast(
  job: any,
  workerStart: number,
  logPrefix: string,
): Promise<{ sent: number; done: boolean; error?: string }> {
  let sent = 0;
  const contacts = job.contacts as { phone: string; name?: string }[];
  const steps = parseBroadcastSteps(job.message_config);
  if (steps.length === 0) {
    console.error(`${logPrefix} message_config sem steps válidos`);
    return { sent: 0, done: false, error: 'message_config inválido' };
  }

  let idx: number = job.current_index;
  let stepIdx =
    typeof job.message_step_index === 'number' && !Number.isNaN(job.message_step_index)
      ? job.message_step_index
      : 0;
  if (stepIdx < 0 || stepIdx >= steps.length) stepIdx = 0;

  let lastSentAt = job.last_sent_at ? new Date(job.last_sent_at).getTime() : 0;
  let delayMs = 0;

  while (idx < job.total_count && idx < contacts.length) {
    const elapsed = Date.now() - workerStart;
    if (elapsed > WORKER_TIMEOUT_MS) {
      console.log(`${logPrefix} Worker timeout (${elapsed}ms), pausando para próximo ciclo`);
      break;
    }

    const sinceLastSend = Date.now() - lastSentAt;
    if (lastSentAt > 0 && sinceLastSend < delayMs) {
      console.log(
        `${logPrefix} Delay não atingido (${Math.round(sinceLastSend / 1000)}s / ${Math.round(delayMs / 1000)}s)`,
      );
      break;
    }

    const rawRotation = job.broadcast_instances as { id: string; name?: string }[] | null;
    const rotation =
      Array.isArray(rawRotation) && rawRotation.length > 0
        ? rawRotation
        : [{ id: job.instance_id as string, name: job.instance_name as string }];
    const pick = rotation[idx % rotation.length];
    const fallbackInstanceId = pick?.id || job.instance_id;

    const contact = contacts[idx];
    const remoteJid = normalizePhone(contact.phone);
    if (!remoteJid) {
      idx += 1;
      stepIdx = 0;
      await supabase
        .from('chat_broadcasts')
        .update({
          current_index: idx,
          message_step_index: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      delayMs = computeNextDelaySeconds(job) * 1000;
      continue;
    }

    const msgConfig = steps[stepIdx];

    const orderedIds = orderedBroadcastInstanceIds(rotation, idx);
    const tryInstanceIds = orderedIds.length > 0 ? orderedIds : [String(fallbackInstanceId)].filter(Boolean);

    let instance: {
      id: string;
      instance_name: string;
      apikey: string;
      phone_number: string | null;
      workspace_id: string | null;
      user_id: string | null;
      evolution_apis: { base_url: string } | { base_url: string }[] | null;
    } | null = null;
    let evolutionRes: Record<string, unknown> | null = null;
    let lastSendError: string | null = null;
    let sawNonUnreachableError = false;

    for (const tryId of tryInstanceIds) {
      const { data: inst } = await supabase
        .from('evolution_instances')
        .select('id, instance_name, apikey, phone_number, workspace_id, user_id, evolution_apis(base_url)')
        .eq('id', tryId)
        .single();

      if (!inst) {
        if (tryInstanceIds.length === 1) {
          console.error(`${logPrefix} Instância não encontrada: ${tryId}`);
          return { sent, done: false, error: 'Instância não encontrada' };
        }
        continue;
      }

      const evolutionApi = Array.isArray(inst.evolution_apis) ? inst.evolution_apis[0] : inst.evolution_apis;

      if (!evolutionApi?.base_url || !inst.apikey) {
        if (tryInstanceIds.length === 1) {
          return { sent, done: false, error: 'Configuração incompleta da Evolution API' };
        }
        continue;
      }

      const baseUrl = normalizeBaseUrl(evolutionApi.base_url);

      try {
        evolutionRes = await sendEvolutionMessage(baseUrl, inst.instance_name, inst.apikey, remoteJid, msgConfig);
        instance = inst;
        lastSendError = null;
        break;
      } catch (err: any) {
        const msg = err?.message || String(err);
        lastSendError = msg;
        await maybeMarkEvolutionInstanceDisconnected(supabase, inst.id, msg, 'cron/broadcast-queue');
        if (!broadcastSendErrorIsInstanceUnreachable(msg)) {
          sawNonUnreachableError = true;
          instance = inst;
          break;
        }
        if (tryInstanceIds.length === 1) break;
      }
    }

    if (!evolutionRes || !instance) {
      if (sawNonUnreachableError && lastSendError) {
        idx += 1;
        stepIdx = 0;
        await supabase
          .from('chat_broadcasts')
          .update({
            current_index: idx,
            message_step_index: 0,
            last_error: lastSendError,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        delayMs = computeNextDelaySeconds(job) * 1000;
        console.warn(`${logPrefix} Contato ${idx} pulado: ${lastSendError}`);
        continue;
      }

      if (lastSendError && broadcastSendErrorIsInstanceUnreachable(lastSendError)) {
        await supabase
          .from('chat_broadcasts')
          .update({ last_error: lastSendError, updated_at: new Date().toISOString() })
          .eq('id', job.id);
        console.error(`${logPrefix} Todas instâncias da rotação offline: ${lastSendError}`);
        return { sent, done: false, error: lastSendError };
      }

      if (!lastSendError && tryInstanceIds.length > 1) {
        console.error(`${logPrefix} Nenhuma instância válida na rotação`);
        return { sent, done: false, error: 'Nenhuma instância válida na rotação' };
      }

      console.error(`${logPrefix} Instância não encontrada`);
      return { sent, done: false, error: 'Instância não encontrada' };
    }

    try {
      const now = new Date().toISOString();
      const mediaLabels: Record<string, string> = {
        audio: '🎵 Áudio',
        video: '🎬 Vídeo',
        image: '🖼️ Imagem',
        document: '📄 Documento',
      };
      const previewText =
        msgConfig.content?.substring(0, 100) ||
        msgConfig.caption?.substring(0, 100) ||
        mediaLabels[msgConfig.type] ||
        '[Mídia]';

      try {
        const { data: conversation } = await supabase
          .from('chat_conversations')
          .upsert(
            {
              instance_id: instance.id,
              workspace_id: instance.workspace_id ?? undefined,
              user_id: instance.user_id ?? undefined,
              remote_jid: remoteJid,
              title: contact.name || remoteJid.replace('@s.whatsapp.net', ''),
              is_group: false,
              last_message_at: now,
              last_message_preview: previewText,
            },
            { onConflict: 'conflict_key,remote_jid' },
          )
          .select()
          .single();

        const returnedMessageId =
          (evolutionRes as Record<string, Record<string, string>>)?.key?.id ||
          (evolutionRes as Record<string, string>)?.messageId ||
          (evolutionRes as Record<string, string>)?.id ||
          null;

        if (returnedMessageId && conversation?.id) {
          await supabase.from('chat_messages').upsert(
            {
              instance_id: instance.id,
              workspace_id: instance.workspace_id ?? undefined,
              user_id: instance.user_id ?? undefined,
              conversation_id: conversation.id,
              message_id: String(returnedMessageId),
              direction: 'out',
              from_me: true,
              sender_jid: instance.phone_number || 'me',
              text: msgConfig.content || '',
              media_type: msgConfig.type !== 'text' ? msgConfig.type : 'text',
              media_url: msgConfig.attachment_url || undefined,
              caption: msgConfig.caption || '',
              status: 'pending',
              timestamp: Math.floor(Date.now() / 1000),
            },
            { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
          );

          await supabase
            .from('chat_conversations')
            .update({ last_message_at: now, last_message_preview: previewText })
            .eq('id', conversation.id);
        }
      } catch {
        // falha ao persistir não para o disparo
      }

      const moreSteps = stepIdx < steps.length - 1;
      lastSentAt = Date.now();

      if (moreSteps) {
        stepIdx += 1;
        await supabase
          .from('chat_broadcasts')
          .update({
            message_step_index: stepIdx,
            last_sent_at: now,
            status: 'running',
            last_error: null,
            updated_at: now,
          })
          .eq('id', job.id);
        delayMs = getSequenceDelaySeconds(job.message_config) * 1000;
        sent += 1;
        console.log(
          `${logPrefix} Sequência ${stepIdx}/${steps.length} contato ${idx + 1}/${job.total_count}: ${contact.name || contact.phone}`,
        );
      } else {
        idx += 1;
        stepIdx = 0;
        const isDone = idx >= job.total_count;
        await supabase
          .from('chat_broadcasts')
          .update({
            current_index: idx,
            message_step_index: 0,
            last_sent_at: now,
            status: isDone ? 'completed' : 'running',
            completed_at: isDone ? now : null,
            last_error: null,
            updated_at: now,
          })
          .eq('id', job.id);
        delayMs = computeNextDelaySeconds(job) * 1000;
        sent += 1;
        console.log(
          `${logPrefix} Enviado ${idx}/${job.total_count}: ${contact.name || contact.phone} (instância ${instance.instance_name})`,
        );
        if (isDone) return { sent, done: true };
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn(`${logPrefix} Pós-envio: ${msg}`);
    }
  }

  return { sent, done: idx >= job.total_count };
}

export const handler = async (): Promise<HandlerResponse> => {
  const workerStart = Date.now();
  const workerId = `bc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  try {
    const { data: jobs, error } = await supabase
      .from('chat_broadcasts')
      .select('*')
      .eq('status', 'running')
      .order('updated_at', { ascending: true })
      .limit(5);

    if (error || !jobs || jobs.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, message: 'Nenhum broadcast running', workerId }),
      };
    }

    console.log(`[${workerId}] ${jobs.length} broadcast(s) running`);

    const results: { jobId: string; sent: number; done: boolean; error?: string }[] = [];

    for (const job of jobs) {
      const prefix = `[${workerId}][${job.id.substring(0, 8)}]`;
      const result = await processOneBroadcast(job, workerStart, prefix);
      results.push({ jobId: job.id, ...result });

      if (Date.now() - workerStart > WORKER_TIMEOUT_MS) break;
    }

    const totalSent = results.reduce((s, r) => s + r.sent, 0);
    console.log(`[${workerId}] Concluído: ${totalSent} msg(s) enviada(s) em ${Date.now() - workerStart}ms`);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, workerId, results, totalSent }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err: any) {
    console.error(`[${workerId}] Erro fatal:`, err?.message);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, error: err?.message, workerId }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};
