/**
 * Webhook WhatsApp Cloud API (Oficial)
 *
 * GET  — verificação (hub.verify_token / hub.challenge)
 * POST — receptor fino: salva o evento bruto em webhook_events e retorna 200 imediatamente.
 *
 * O processamento (chat_conversations + chat_messages) é desacoplado e ocorre via:
 *   - Supabase Realtime no frontend: INSERT em webhook_events → POST /api/chat/webhook-events/process
 *   - Recuperação manual/cron: POST /api/chat/webhook-events/process-pending (eventos com processed_at IS NULL)
 */

import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

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
// POST — Receptor fino: persiste payload bruto e retorna 200
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

    const { error: insertError } = await supabaseServiceRole
      .from('webhook_events')
      .insert({
        source: SOURCE,
        event_name: EVENT_NAME,
        raw_payload: payload as object,
      });

    if (insertError) {
      console.error('[Zaploto Webhook] Erro ao inserir webhook_event:', insertError.message, insertError.details);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[Zaploto Webhook] Erro inesperado:', err);
    return new Response('OK', { status: 200 });
  }
}
