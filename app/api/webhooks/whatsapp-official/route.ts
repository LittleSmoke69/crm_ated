/**
 * Webhook WhatsApp Cloud API (Oficial)
 *
 * GET  — verificação (hub.verify_token / hub.challenge)
 * POST — eventos (mensagens recebidas, status updates)
 *
 * Sempre retorna 200 para a Meta (exige resposta < 5 s).
 * 1) Salva o evento em webhook_events (raw_payload).
 * 2) Processa o payload e organiza em chat_conversations + chat_messages.
 * 3) Marca processed_at no evento.
 */

import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { processMetaPayloadToChat } from '@/lib/services/whatsapp-official-webhook-processor';

const SOURCE = 'whatsapp_official';
const EVENT_NAME = 'whatsapp_official';

function isWhatsAppOfficialPayload(payload: unknown): payload is { object: string; entry?: unknown[] } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { object?: string }).object === 'whatsapp_business_account'
  );
}

// ---------------------------------------------------------------------------
// GET — Verificação do webhook (Meta)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode !== 'subscribe' || !challenge) {
    return new Response('Bad Request', { status: 400 });
  }

  const { data: config } = await supabaseServiceRole
    .from('whatsapp_official_configs')
    .select('id')
    .eq('verify_token', token || '')
    .limit(1)
    .maybeSingle();

  if (!config) {
    return new Response('Forbidden', { status: 403 });
  }

  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

// ---------------------------------------------------------------------------
// POST — Eventos: salva em webhook_events e organiza no chat
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let payload: unknown;

  try {
    const rawBody = await req.text();
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!isWhatsAppOfficialPayload(payload)) {
      return new Response('OK', { status: 200 });
    }

    // 1) Salvar evento na tabela webhook_events (fonte dos dados)
    const { data: inserted, error: insertError } = await supabaseServiceRole
      .from('webhook_events')
      .insert({
        source: SOURCE,
        event_name: EVENT_NAME,
        raw_payload: payload as object,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[Zaploto Chat] Erro ao inserir webhook_event:', insertError.message, insertError.details);
      return new Response('OK', { status: 200 });
    }

    const eventId = inserted?.id as string | undefined;

    // 2) Organizar dados do payload em chat_conversations e chat_messages (tempo real)
    try {
      await processMetaPayloadToChat(payload);
    } catch (err) {
      console.error('[Zaploto Chat] Erro ao processar payload para chat:', err);
      // Não atualiza processed_at; evento pode ser reprocessado via API
      return new Response('OK', { status: 200 });
    }

    // 3) Marcar evento como processado
    if (eventId) {
      await supabaseServiceRole
        .from('webhook_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', eventId);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[Zaploto Chat] Erro inesperado no webhook:', err);
    return new Response('OK', { status: 200 });
  }
}
