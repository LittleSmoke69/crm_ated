/*
 * WEBHOOK EVOLUTION — Chat + Registro de eventos para flows
 *
 * Responsabilidades:
 * 1. Valida token e instância (síncrono — necessário para obter workspace_id/user_id)
 * 2. Retorna 200 IMEDIATAMENTE via after() — nunca bloqueia a Evolution API
 * 3. Em background:
 *    - Salva mensagem em chat_conversations / chat_messages
 *    - Salva evento em evolution_webhook_events (necessário para disparar flows)
 *    - Atualiza unread_count para mensagens recebidas
 */

import { NextRequest, after } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import { normalizationService } from '@/lib/services/normalization-service';

// ── Utilitários ───────────────────────────────────────────────────────────────

function pickFirstString(...values: any[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pickProfilePicUrl(data: any): string | null {
  const candidate = pickFirstString(
    data?.profilePicUrl,
    data?.profile_pic_url,
    data?.contact?.profilePicUrl,
    data?.contact?.profile_pic_url,
    data?.sender?.profilePicUrl,
    data?.sender?.profile_pic_url,
  );
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) return null;
  return candidate;
}

function extractText(message: any): string {
  if (typeof message === 'string') return message;
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.message?.conversation ||
    ''
  );
}

function extractMediaType(message: any): string {
  if (message.imageMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.documentMessage) return 'document';
  return 'text';
}

function extractMediaUrl(message: any, rawPayload?: any): string | null {
  const absoluteUrl =
    message?.imageMessage?.url ||
    message?.videoMessage?.url ||
    message?.audioMessage?.url ||
    message?.documentMessage?.url ||
    message?.stickerMessage?.url ||
    null;

  if (absoluteUrl && typeof absoluteUrl === 'string' && absoluteUrl.trim()) {
    return absoluteUrl.trim();
  }

  const directPath =
    message?.imageMessage?.directPath ||
    message?.videoMessage?.directPath ||
    message?.audioMessage?.directPath ||
    message?.documentMessage?.directPath ||
    message?.stickerMessage?.directPath ||
    null;

  if (typeof directPath === 'string' && directPath.trim()) {
    const base = String(rawPayload?.server_url || '').replace(/\/+$/, '');
    const path = directPath.startsWith('/') ? directPath : `/${directPath}`;
    if (base) return `${base}${path}`;
  }

  const base64 = typeof message?.base64 === 'string' ? message.base64.trim() : '';
  if (base64 && message?.imageMessage) {
    const mime = message?.imageMessage?.mimetype || 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  }

  return null;
}

function extractCaption(message: any): string {
  return (
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
  );
}

// ── Handlers de processamento (executados em background) ─────────────────────

/**
 * Salva a mensagem no chat E registra em evolution_webhook_events.
 * O registro em evolution_webhook_events é necessário para que flows
 * baseados em MESSAGES_UPSERT sejam disparados.
 */
async function handleMessageUpsert(
  instance: { id: string; workspace_id: string; user_id: string; instance_name: string },
  data: any,
  fromMe: boolean,
  rawPayload: any,
): Promise<void> {
  const message = data?.message || data;
  const key = message?.key || data?.key || {};
  const remoteJid = key?.remoteJid || data?.remoteJid;

  if (!remoteJid) {
    console.error('❌ [WEBHOOK] MESSAGES_UPSERT sem remoteJid', { instance: instance.instance_name });
    return;
  }

  // 1. Upsert da conversa no chat
  const conversation = await chatService.upsertConversation({
    instance_id: instance.id,
    workspace_id: instance.workspace_id,
    user_id: instance.user_id,
    remote_jid: remoteJid,
    title: data.pushName || remoteJid.split('@')[0],
    profile_pic_url: pickProfilePicUrl(data) || undefined,
    is_group: remoteJid.endsWith('@g.us'),
    last_message_at: new Date().toISOString(),
    last_message_preview: extractText(message).substring(0, 100),
  });

  // 2. Salva a mensagem no chat
  await chatService.saveMessage({
    instance_id: instance.id,
    workspace_id: instance.workspace_id,
    user_id: instance.user_id,
    conversation_id: conversation.id,
    message_id: key.id || data.id || data.messageId,
    direction: ((key.fromMe || fromMe) ? 'out' : 'in') as 'in' | 'out',
    from_me: key.fromMe || fromMe,
    sender_jid: key.participant || key.remoteJid || data.sender || remoteJid,
    text: extractText(message),
    media_type: extractMediaType(message),
    media_url: extractMediaUrl(message, rawPayload) || undefined,
    caption: extractCaption(message),
    status: (key.fromMe || fromMe) ? 'sent' : 'received',
    timestamp: data.messageTimestamp || Math.floor(Date.now() / 1000),
  });

  // 3. Incrementa unread para mensagens recebidas
  if (!(key.fromMe || fromMe)) {
    try {
      await supabaseServiceRole.rpc('increment_unread_count', { conv_id: conversation.id });
    } catch {
      await supabaseServiceRole
        .from('chat_conversations')
        .update({ unread_count: (conversation.unread_count || 0) + 1 })
        .eq('id', conversation.id);
    }
  }

  // 4. Registra em evolution_webhook_events para que flows possam ser disparados
  //    (ex: flow de resposta automática a mensagens, tryResumePendingQuestion)
  try {
    const eventType = fromMe ? 'SEND_MESSAGE' : 'MESSAGES_UPSERT';
    const messageId = key.id || data.id || data.messageId || null;

    let normalizedPayload: any = null;
    try {
      normalizedPayload = await normalizationService.normalizePayload(
        eventType,
        rawPayload,
        instance.instance_name,
      );
    } catch {
      // Continua sem normalização
    }

    await supabaseServiceRole.from('evolution_webhook_events').insert({
      env: 'prod',
      event_type: eventType,
      instance_name: instance.instance_name,
      remote_jid: remoteJid,
      message_id: messageId,
      payload: rawPayload,
      payload_normalized: normalizedPayload || null,
    });
  } catch (err: any) {
    console.error('❌ [WEBHOOK] Falha ao registrar em evolution_webhook_events:', err?.message);
  }
}

async function handleMessageUpdate(
  instance: { id: string },
  data: any,
): Promise<void> {
  const key = data.key || {};
  if (!key.id) return;

  const statusMap: Record<number, string> = {
    2: 'sent',
    3: 'delivered',
    4: 'read',
    5: 'played',
  };

  const newStatus = statusMap[data.status] || 'updated';

  await supabaseServiceRole
    .from('chat_messages')
    .update({ status: newStatus })
    .eq('instance_id', instance.id)
    .eq('message_id', key.id);
}

async function handleMessageDelete(
  instance: { id: string },
  data: any,
): Promise<void> {
  const key = data.key || {};
  if (!key.id) return;

  await supabaseServiceRole
    .from('chat_messages')
    .delete()
    .eq('instance_id', instance.id)
    .eq('message_id', key.id);
}

// ── Route handlers ─────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/evolution
 *
 * Valida token + instância de forma síncrona, depois retorna 200 imediatamente.
 * Todo o processamento de chat e registro de eventos é feito via after().
 */
export async function POST(req: NextRequest) {
  try {
    // ── Validação de token (síncrono) ──────────────────────────────────────
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const expectedToken = process.env.EVOLUTION_WEBHOOK_TOKEN;
    const allowNoToken = process.env.EVOLUTION_WEBHOOK_ALLOW_NO_TOKEN === 'true';

    const headerToken =
      req.headers.get('x-evolution-webhook-token') ||
      req.headers.get('x-webhook-token') ||
      (req.headers.get('authorization')?.startsWith('Bearer ')
        ? req.headers.get('authorization')?.replace('Bearer ', '').trim()
        : null);

    const tokenMatches =
      !!expectedToken &&
      ((token && token === expectedToken) || (headerToken && headerToken === expectedToken));

    if (expectedToken && !tokenMatches && !allowNoToken) {
      return new Response('Unauthorized', { status: 401 });
    }

    // ── Parse do payload ───────────────────────────────────────────────────
    const rawBody = await req.text();
    let payload: any = null;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const event = pickFirstString(
      payload?.event,
      payload?.eventType,
      payload?.type,
      payload?.data?.event,
    );
    const instanceName = pickFirstString(
      payload?.instance,
      payload?.instanceName,
      payload?.data?.instance,
      payload?.data?.instanceName,
    );

    if (!event || !instanceName) {
      return new Response('Invalid payload', { status: 400 });
    }

    // ── Busca instância (síncrono — necessário para workspace_id/user_id) ──
    const { data: dbInstance, error: instError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, workspace_id, user_id, instance_name')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .maybeSingle();

    if (instError || !dbInstance) {
      console.error(`❌ [WEBHOOK] Instância "${instanceName}" não encontrada ou inativa`);
      return new Response('Instance not found', { status: 404 });
    }

    const data = payload?.data ?? payload;

    // ── Processa em background — retorna 200 imediatamente ─────────────────
    after(async () => {
      try {
        switch (event) {
          case 'MESSAGES_UPSERT':
          case 'SEND_MESSAGE':
            await handleMessageUpsert(dbInstance, data, event === 'SEND_MESSAGE', payload);
            break;

          case 'MESSAGES_UPDATE':
            await handleMessageUpdate(dbInstance, data);
            break;

          case 'MESSAGES_DELETE':
            await handleMessageDelete(dbInstance, data);
            break;

          default:
            break;
        }
      } catch (err: any) {
        console.error(`❌ [WEBHOOK] Erro ao processar evento ${event}:`, err?.message || err);
      }
    });

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('❌ [WEBHOOK] Erro inesperado:', err);
    // Sempre retorna 200 para não causar retries da Evolution API
    return new Response('OK', { status: 200 });
  }
}

/**
 * GET /api/webhooks/evolution
 * Healthcheck rápido para validar se o endpoint está público e respondendo.
 */
export async function GET() {
  const expectedToken = process.env.EVOLUTION_WEBHOOK_TOKEN;
  const allowNoToken = process.env.EVOLUTION_WEBHOOK_ALLOW_NO_TOKEN === 'true';

  return new Response(
    JSON.stringify({
      ok: true,
      now: new Date().toISOString(),
      token_required: !!expectedToken && !allowNoToken,
      allow_no_token: allowNoToken,
      status: 'webhook_active',
      message: 'Webhook ativo e funcionando',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
