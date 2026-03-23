/**
 * Webhook WhatsApp Cloud API (Oficial)
 *
 * GET  — verificação (hub.verify_token / hub.challenge)
 * POST — receptor fino: salva o evento bruto em webhook_events, processa
 *        imediatamente via after() (background) e retorna 200.
 *
 * O processamento (chat_conversations + chat_messages) ocorre:
 *   1. Server-side via after() — logo após salvar o evento (não depende do frontend)
 *   2. Supabase Realtime no frontend — duplicação é ignorada (saveMessage usa ignoreDuplicates)
 *   3. Recuperação manual/cron — POST /api/chat/webhook-events/process-pending
 */

import { NextRequest, after } from 'next/server';
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
// POST — Receptor fino: persiste payload bruto, processa em background
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!isWhatsAppOfficialPayload(payload)) {
      return new Response('OK', { status: 200 });
    }

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
      console.error('[Zaploto Webhook] Erro ao inserir webhook_event:', insertError.message, insertError.details);
      // Sem persistir o evento, perdemos a trilha de reprocessamento.
      // Retornar 500 força retry da Meta em vez de confirmar recebimento com risco de perda.
      return new Response('Webhook event persistence failed', { status: 500 });
    }

    // Processa o evento imediatamente em background (após enviar 200)
    const eventId = inserted?.id;
    const savedPayload = payload;
    after(async () => {
      try {
        await processMetaPayloadToChat(savedPayload);
        if (eventId) {
          await supabaseServiceRole
            .from('webhook_events')
            .update({ processed_at: new Date().toISOString() })
            .eq('id', eventId);
        }
      } catch (err) {
        console.error('[Zaploto Webhook] Erro no processamento background:', err instanceof Error ? err.message : err);
      }
    });

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[Zaploto Webhook] Erro inesperado:', err);
    return new Response('OK', { status: 200 });
  }
}
