import { NextRequest, after } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizationService } from '@/lib/services/normalization-service';
import { flowExecutorService } from '@/lib/services/flow-executor-service';
import { participantExitAuditService } from '@/lib/services/participant-exit-audit-service';
import { EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES } from '@/lib/utils/evolution-group-participant-event-types';

/** Janela de deduplicação de eventos group-participants no ambiente de teste: 15 segundos */
const PARTICIPANT_DEDUP_WINDOW_MS = 15_000;

const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;
const POST_INSERT_DEDUP_LIMIT = 120;

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Extrai o ID do primeiro participante do payload
 */
function extractFirstParticipantId(payload: any): string | null {
  const participants: any[] = payload?.data?.participants ?? [];
  const firstParticipant = participants[0];
  if (!firstParticipant) return null;
  
  const participantId = String(
    firstParticipant?.id ??
    firstParticipant?.phoneNumber ??
    (typeof firstParticipant === 'string' ? firstParticipant : '') ??
    '',
  ).trim();
  
  return participantId || null;
}

/**
 * Extrai os campos de metadata do payload Evolution de forma síncrona — sem DB.
 */
function extractMetadata(payload: any) {
  const eventType =
    payload?.event ||
    payload?.type ||
    payload?.data?.event ||
    'unknown';

  const instanceName =
    payload?.instance?.instanceName ||
    payload?.instanceName ||
    payload?.instance ||
    null;

  const messageId =
    payload?.data?.key?.id ||
    payload?.data?.message?.key?.id ||
    payload?.key?.id ||
    payload?.id ||
    null;

  const remoteJid =
    payload?.data?.id ||
    payload?.data?.key?.remoteJid ||
    payload?.data?.message?.key?.remoteJid ||
    payload?.key?.remoteJid ||
    payload?.remoteJid ||
    payload?.data?.groupJid ||
    null;

  return { eventType, instanceName, messageId, remoteJid };
}

/**
 * Processamento completo do evento de teste: insert + waiters + flows.
 * Executado via `after()` — após o response 200 já ter sido enviado.
 */
async function processEventBackground(payload: any): Promise<void> {
  const { eventType, instanceName, messageId, remoteJid } = extractMetadata(payload);
  const evtNorm = String(eventType).toLowerCase().replace(/_/g, '-');
  const isGroupParticipants =
    evtNorm === 'group-participants.update' || evtNorm === 'group-participants-update';
  const actionRaw = String(payload?.data?.action ?? payload?.action ?? '').toLowerCase();

  // ── Deduplicação pré-insert de group-participants ──────────────────────────
  // Camada 1: fast-path — se já existe evento recente com mesmo fingerprint (instance + group + participant), descarta.
  // Não filtra por env: protege contra double-trigger prod+test.
  if (isGroupParticipants && actionRaw === 'add' && instanceName && remoteJid) {
    const firstParticipantId = extractFirstParticipantId(payload);

    if (firstParticipantId) {
      const since = new Date(Date.now() - PARTICIPANT_DEDUP_WINDOW_MS).toISOString();
      
      // Busca evento duplicado considerando instance + group + participant
      // Usa payload->data->participants[0] para comparar o participante
      const { data: existing } = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('id, payload')
        .eq('instance_name', instanceName)
        .eq('remote_jid', remoteJid)
        .in('event_type', EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(10); // Busca últimos 10 para comparar participantes

      if (existing && existing.length > 0) {
        // Compara participantes dos eventos existentes
        for (const evt of existing) {
          const existingParticipantId = extractFirstParticipantId(evt.payload);
          if (existingParticipantId && existingParticipantId === firstParticipantId) {
            console.log(
              `⚠️ [WEBHOOK TEST] group-participants duplicado (pré-insert) — instância=${instanceName} grupo=${remoteJid} participante=${firstParticipantId} (evento existente: ${evt.id})`,
            );
            return;
          }
        }
      }
    }
  }

  // ── Normalização ──────────────────────────────────────────────────────────
  let normalizedPayload: any = null;
  let normalizationError: any = null;
  try {
    normalizedPayload = await normalizationService.normalizePayload(
      eventType,
      payload,
      instanceName || undefined,
      { ruleFetchMaxAttempts: 1 },
    );
  } catch (err: any) {
    normalizationError = err;
    console.warn(
      `⚠️ [WEBHOOK TEST] Falha na normalização (usando payload original como fallback):`,
      err?.message || err,
    );
    // Continua sem normalização — usaremos payload original como fallback
  }

  // ── Insere no banco ────────────────────────────────────────────────────────
  const { data: event, error: insertError } = await supabaseServiceRole
    .from('evolution_webhook_events')
    .insert({
      env: 'test',
      event_type: eventType,
      instance_name: instanceName,
      remote_jid: remoteJid,
      message_id: messageId,
      payload: payload,
      payload_normalized: normalizedPayload || null,
    })
    .select('id, env, instance_name, payload, payload_normalized')
    .single();

  if (insertError || !event) {
    // Violação de unique constraint: evento já foi inserido numa entrega anterior — comportamento esperado e idempotente.
    if (insertError?.code === '23505') {
      console.warn(
        `⚠️ [WEBHOOK TEST] Evento duplicado ignorado (message_id=${messageId}, instance=${instanceName})`,
      );
      return;
    }
    console.error('❌ [WEBHOOK TEST] Falha ao inserir evento:', insertError?.message);
    return;
  }

  // ── Dedup pós-insert para group-participants (protege contra race condition) ──
  // Camada 2: quando dois webhooks chegam quase simultaneamente, ambos passam
  // pela dedup pré-insert. Aqui verificamos qual foi o PRIMEIRO inserido na
  // janela para o MESMO participante — apenas ele prossegue para executar o flow.
  // Não filtra por env: protege também contra double-trigger prod+test.
  if (isGroupParticipants && actionRaw === 'add' && instanceName && remoteJid) {
    const firstParticipantId = extractFirstParticipantId(payload);
    
    if (firstParticipantId) {
      const dedupSince = new Date(Date.now() - PARTICIPANT_DEDUP_WINDOW_MS).toISOString();
      // Busca eventos recentes do mesmo grupo
      const { data: recentEvents } = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('id, payload')
        .eq('instance_name', instanceName)
        .eq('remote_jid', remoteJid)
        .in('event_type', EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES)
        .gte('created_at', dedupSince)
        .order('created_at', { ascending: true })
        .limit(POST_INSERT_DEDUP_LIMIT);

      if (recentEvents && recentEvents.length > 0) {
        // Encontra o primeiro evento com o mesmo participante
        for (const evt of recentEvents) {
          if (evt.id === event.id) continue; // Pula o evento atual
          
          const evtParticipantId = extractFirstParticipantId(evt.payload);
          if (evtParticipantId && evtParticipantId === firstParticipantId) {
            console.log(
              `⚠️ [WEBHOOK TEST] Post-insert dedup: evento ${event.id} ignorado (primeiro evento para participante ${firstParticipantId}: ${evt.id})`,
            );
            return;
          }
        }
      }
    }
  }

  // ── Auditoria de saída de participantes ───────────────────────────────────
  if (
    eventType === participantExitAuditService.EVENT_TYPE &&
    (payload?.data?.action === 'remove' || payload?.action === 'remove')
  ) {
    participantExitAuditService
      .recordParticipantExit(payload, instanceName)
      .catch((err) => {
        console.error('❌ [WEBHOOK TEST] Auditoria de saída:', err?.message || err);
      });
  }

  // ── Waiters do modo de teste (n8n-style) ─────────────────────────────────
  const { data: activeWaiters } = await supabaseServiceRole
    .from('evolution_webhook_test_waiters')
    .select('id')
    .eq('status', 'waiting')
    .eq('env', 'test')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(1);

  if (activeWaiters && activeWaiters.length > 0) {
    await supabaseServiceRole
      .from('evolution_webhook_test_waiters')
      .update({
        status: 'received',
        received_event_id: event.id,
        received_at: new Date().toISOString(),
      })
      .eq('id', activeWaiters[0].id);
  }

  // ── Flows ─────────────────────────────────────────────────────────────────
  // Usa payload normalizado se disponível, senão usa payload original como fallback
  const np = normalizedPayload || payload;
  
  if (!np) {
    console.error('❌ [WEBHOOK TEST] Sem payload disponível (normalizado ou original) para processar flows');
    return;
  }

  // Log quando usando fallback
  if (!normalizedPayload && normalizationError) {
    console.warn(
      `⚠️ [WEBHOOK TEST] Processando flows com payload original (normalização falhou):`,
      normalizationError?.message || 'Erro desconhecido',
    );
  }

  const resumed = await flowExecutorService.tryResumePendingQuestionFromWebhookEvent(event.id);
  if (resumed) {
    console.log('✅ [WEBHOOK TEST] Flow retomado (nó Pergunta — resposta)');
    return;
  }

  // Extrai groupJid para flows de participantes
  let groupJid =
    payload?.data?.id ??
    np?.data?.id ??
    np?.normalized?.groupId ??
    np?.normalized?.group_id ??
    np?.groupId ??
    np?.group_id ??
    payload?.data?.key?.remoteJid ??
    payload?.data?.groupJid ??
    (remoteJid && String(remoteJid).includes('@g.us') ? remoteJid : null) ??
    null;

  // Valida se groupJid é realmente um grupo (deve terminar com @g.us)
  if (groupJid && !String(groupJid).endsWith('@g.us')) {
    console.warn(
      `⚠️ [WEBHOOK TEST] groupJid extraído não é um grupo válido (não termina com @g.us): ${groupJid}. Ignorando processamento de flows de grupo.`,
    );
    groupJid = null;
  }

  // group-participants.update → flow_instances
  if (
    (isGroupParticipants || String(eventType || '').toLowerCase().includes('participants')) &&
    instanceName &&
    groupJid
  ) {
    const matching = await flowExecutorService.findMatchingFlowInstances(
      eventType,
      instanceName,
      String(groupJid),
      np,
    );

    for (const { flow_id, user_id, settings_json } of matching) {
      try {
        await flowExecutorService.executeFlow(flow_id, event.id, user_id, settings_json);
      } catch (flowErr: any) {
        console.error(`❌ [WEBHOOK TEST] Erro ao executar flow ${flow_id}:`, flowErr.message);
      }
    }
    return;
  }

  // Outros eventos → findMatchingFlows global
  const matchingFlows = await flowExecutorService.findMatchingFlows(
    eventType,
    instanceName,
    np,
  );

  for (const flow of matchingFlows) {
    if (!flow.user_id) continue;
    try {
      await flowExecutorService.executeFlow(flow.id, event.id, flow.user_id);
    } catch (flowErr: any) {
      console.error(`❌ [WEBHOOK TEST] Erro ao executar flow ${flow.id}:`, flowErr.message);
    }
  }
}

/**
 * POST /api/webhooks/evolution/test
 *
 * Retorna 200 IMEDIATAMENTE após parsear o JSON.
 * Todo o processamento é agendado via `after()` — executado após o response.
 */
export async function POST(req: NextRequest) {
  try {
    let payload: any;
    try {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > MAX_WEBHOOK_BODY_BYTES) {
        return new Response(JSON.stringify({ ok: false, error: 'Payload muito grande' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const text = new TextDecoder().decode(buf);
      payload = text ? JSON.parse(text) : {};
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    after(() =>
      processEventBackground(payload).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('❌ [WEBHOOK TEST] Erro no processamento em background:', msg);
      }),
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('❌ [WEBHOOK TEST] Erro ao parsear request:', err);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/webhooks/evolution/test
 * Healthcheck — confirma que o endpoint está acessível.
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      env: 'test',
      now: new Date().toISOString(),
      message: 'Webhook Evolution TEST está ativo',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
