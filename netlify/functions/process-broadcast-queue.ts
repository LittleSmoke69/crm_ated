/**
 * Netlify Scheduled Function: process-broadcast-queue
 *
 * Roda a cada 1 minuto. Processa broadcasts com status 'running' respeitando
 * o delay_seconds entre envios. Garante que o disparo continue mesmo se o
 * usuário fechar o navegador — funciona como o process-message-queue.
 *
 * Fluxo por broadcast:
 * 1. Verifica se já passou delay_seconds desde last_sent_at
 * 2. Busca instância e credenciais
 * 3. Envia mensagem via Evolution API
 * 4. Persiste conversa e mensagem no chat (realtime)
 * 5. Avança current_index e atualiza last_sent_at
 * 6. Repete até acabar o tempo do worker (~20s) ou o delay impedir
 */

import { createClient } from '@supabase/supabase-js';

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
    endpoint = `${baseUrl}/message/sendMedia/${instanceName}`;
    body = {
      ...body,
      media: msgConfig.attachment_url,
      mediatype: msgConfig.type,
      mimetype: msgConfig.mimetype,
      caption: msgConfig.caption,
      fileName: msgConfig.fileName,
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

  const { data: instance } = await supabase
    .from('evolution_instances')
    .select('id, instance_name, apikey, phone_number, workspace_id, user_id, evolution_apis(base_url)')
    .eq('id', job.instance_id)
    .single();

  if (!instance) return { sent: 0, done: false, error: 'Instância não encontrada' };

  const evolutionApi = Array.isArray(instance.evolution_apis)
    ? instance.evolution_apis[0]
    : instance.evolution_apis;

  if (!evolutionApi?.base_url || !instance.apikey) {
    return { sent: 0, done: false, error: 'Configuração incompleta da Evolution API' };
  }

  const baseUrl = normalizeBaseUrl(evolutionApi.base_url);
  const msgConfig = job.message_config as {
    type: string;
    content?: string;
    attachment_url?: string;
    mimetype?: string;
    caption?: string;
    fileName?: string;
  };

  let idx: number = job.current_index;
  let lastSentAt = job.last_sent_at ? new Date(job.last_sent_at).getTime() : 0;
  const delayMs = (job.delay_seconds || 120) * 1000;

  while (idx < job.total_count && idx < contacts.length) {
    const elapsed = Date.now() - workerStart;
    if (elapsed > WORKER_TIMEOUT_MS) {
      console.log(`${logPrefix} Worker timeout (${elapsed}ms), pausando para próximo ciclo`);
      break;
    }

    const sinceLastSend = Date.now() - lastSentAt;
    if (lastSentAt > 0 && sinceLastSend < delayMs) {
      console.log(`${logPrefix} Delay não atingido (${Math.round(sinceLastSend / 1000)}s / ${job.delay_seconds}s)`);
      break;
    }

    const contact = contacts[idx];
    const remoteJid = normalizePhone(contact.phone);
    if (!remoteJid) {
      idx++;
      await supabase
        .from('chat_broadcasts')
        .update({ current_index: idx, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      continue;
    }

    try {
      const evolutionRes = await sendEvolutionMessage(
        baseUrl,
        instance.instance_name,
        instance.apikey,
        remoteJid,
        msgConfig,
      );

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

      idx++;
      sent++;
      lastSentAt = Date.now();
      const isDone = idx >= job.total_count;

      await supabase
        .from('chat_broadcasts')
        .update({
          current_index: idx,
          last_sent_at: new Date().toISOString(),
          status: isDone ? 'completed' : 'running',
          completed_at: isDone ? new Date().toISOString() : null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      console.log(
        `${logPrefix} Enviado ${idx}/${job.total_count}: ${contact.name || contact.phone}`,
      );

      if (isDone) return { sent, done: true };
    } catch (err: any) {
      const msg = err?.message || String(err);
      const isDown =
        /timeout|ECONNREFUSED|ENOTFOUND|network|socket|offline|disconnected/i.test(msg);

      if (isDown) {
        await supabase
          .from('chat_broadcasts')
          .update({ last_error: msg, updated_at: new Date().toISOString() })
          .eq('id', job.id);
        console.error(`${logPrefix} Instância offline: ${msg}`);
        return { sent, done: false, error: msg };
      }

      idx++;
      await supabase
        .from('chat_broadcasts')
        .update({
          current_index: idx,
          last_error: msg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      console.warn(`${logPrefix} Contato ${idx} pulado: ${msg}`);
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
