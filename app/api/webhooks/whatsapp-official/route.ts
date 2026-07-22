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
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { processMetaPayloadToChat } from '@/lib/services/whatsapp-official-webhook-processor';

const SOURCE = 'whatsapp_official';
const EVENT_NAME = 'whatsapp_official';
const MAX_BODY_BYTES = 1_000_000; // 1 MB — folga generosa; payloads reais são muito menores

// Tetos por IP/minuto. Altos de propósito: só barram flood/abuso — o tráfego
// normal da Meta (inclusive rajadas) fica bem abaixo. 429 repetido faz a Meta
// considerar o webhook instável, então NÃO apertar sem necessidade.
const POST_RATE_MAX = 1200; // ~20 req/s por IP
const GET_RATE_MAX = 60; // verificação/probe do verify_token
const RATE_WINDOW_MS = 60 * 1000;

function timingSafeMatch(expectedHex: string, receivedHex: string): boolean {
  const a = Buffer.from(expectedHex);
  const b = Buffer.from(receivedHex);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Valida o header X-Hub-Signature-256 da Meta: sha256=HMAC_SHA256(appSecret, rawBody).
 * Fonte do segredo (nesta ordem): env WHATSAPP_OFFICIAL_APP_SECRET (App Secret, único
 * por App Meta) ou, como fallback, whatsapp_official_configs.webhook_secret dos configs ativos.
 * Retorna:
 *   'valid'   — assinatura confere;
 *   'invalid' — há segredo configurado mas a assinatura não bate (ou está ausente);
 *   'skipped' — nenhum segredo configurado (retrocompatível — não bloqueia).
 */
async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<'valid' | 'invalid' | 'skipped'> {
  const secrets: string[] = [];
  const envSecret = process.env.WHATSAPP_OFFICIAL_APP_SECRET?.trim();
  if (envSecret) {
    secrets.push(envSecret);
  } else {
    const { data } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('webhook_secret')
      .eq('is_active', true)
      .not('webhook_secret', 'is', null);
    for (const row of data ?? []) {
      const s = (row as { webhook_secret?: string }).webhook_secret?.trim();
      if (s) secrets.push(s);
    }
  }

  if (secrets.length === 0) return 'skipped';

  const provided = (signatureHeader || '').replace(/^sha256=/, '').trim();
  if (!provided) return 'invalid';

  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    if (timingSafeMatch(expected, provided)) return 'valid';
  }
  return 'invalid';
}

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
  if (checkIpRateLimit(req, 'wa-official-verify', GET_RATE_MAX, RATE_WINDOW_MS)) {
    return new Response('Too Many Requests', { status: 429 });
  }

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
    .eq('is_active', true)
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
    // Rate limit por IP (barra flood; teto alto p/ não afetar a Meta).
    if (checkIpRateLimit(req, 'wa-official-webhook', POST_RATE_MAX, RATE_WINDOW_MS)) {
      return new Response('Too Many Requests', { status: 429 });
    }

    // Guard de tamanho: eventos da Meta são pequenos (<~64KB). Rejeita corpos
    // absurdos antes de bufferizar/parsear (proteção contra abuso de memória).
    const declaredLength = Number(req.headers.get('content-length') || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return new Response('Payload too large', { status: 413 });
    }

    // Valida a origem (Meta) antes de qualquer processamento.
    const sigResult = await verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'));
    if (sigResult === 'invalid') {
      console.warn('[Zaploto Webhook] Assinatura X-Hub-Signature-256 inválida — requisição rejeitada.');
      return new Response('Invalid signature', { status: 401 });
    }
    if (sigResult === 'skipped') {
      // Em produção, nunca aceitar webhook sem segredo configurado — falha fechada.
      // Em dev/test, mantém o comportamento retrocompatível (apenas avisa).
      if (process.env.NODE_ENV === 'production') {
        console.error(
          '[Zaploto Webhook] Sem App Secret configurado (WHATSAPP_OFFICIAL_APP_SECRET ou webhook_secret) em produção — requisição rejeitada.',
        );
        return new Response('Webhook not configured', { status: 401 });
      }
      console.warn(
        '[Zaploto Webhook] Sem App Secret configurado (WHATSAPP_OFFICIAL_APP_SECRET ou webhook_secret) — assinatura NÃO verificada.',
      );
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (!isWhatsAppOfficialPayload(payload)) {
      return new Response('OK', { status: 200 });
    }

    // Guard final antes do insert em jsonb: só objeto/array não-nulo passa daqui,
    // mas revalida explicitamente para eliminar qualquer risco de PGRST102.
    if (typeof payload !== 'object' || payload === null) {
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
