import { NextRequest, after } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizationService } from '@/lib/services/normalization-service';
import { flowExecutorService } from '@/lib/services/flow-executor-service';
import { participantExitAuditService } from '@/lib/services/participant-exit-audit-service';

/** Janela de deduplicação de eventos group-participants: 30 segundos */
const PARTICIPANT_DEDUP_WINDOW_MS = 30_000;

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

  // group-participants: grupo vem em data.id
  // mensagens: vem em data.key.remoteJid
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
 * Processamento completo do evento: insert no banco + disparo de flows.
 * Executado via `after()` — APÓS o response 200 já ter sido enviado.
 * Nunca bloqueia a resposta da Evolution API.
 */
async function processEventBackground(payload: any): Promise<void> {
  const { eventType, instanceName, messageId, remoteJid } = extractMetadata(payload);
  const evtNorm = String(eventType).toLowerCase().replace(/_/g, '-');

  // ── Deduplicação de group-participants (1 query, em background) ────────────
  // Evita double-trigger de boas-vindas quando a Evolution retransmite o evento.
  // Feita aqui (background) para não atrasar o response 200.
  if (evtNorm === 'group-participants.update' && instanceName && remoteJid) {
    const action = payload?.data?.action ?? payload?.action ?? '';
    const participants: any[] = payload?.data?.participants ?? [];
    const firstParticipantId = String(
      participants[0]?.id ?? participants[0]?.phoneNumber ?? '',
    );

    if (firstParticipantId && action === 'add') {
      const since = new Date(Date.now() - PARTICIPANT_DEDUP_WINDOW_MS).toISOString();
      const { data: existing } = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('id')
        .eq('instance_name', instanceName)
        .eq('remote_jid', remoteJid)
        .in('event_type', ['group-participants.update', 'GROUP_PARTICIPANTS_UPDATE'])
        .gte('created_at', since)
        .limit(1)
        .maybeSingle();

      if (existing) {
        console.log(
          `⚠️ [WEBHOOK PROD] group-participants duplicado — instância=${instanceName} grupo=${remoteJid} participante=${firstParticipantId}`,
        );
        return;
      }
    }
  }

  // ── Normalização ──────────────────────────────────────────────────────────
  let normalizedPayload: any = null;
  try {
    normalizedPayload = await normalizationService.normalizePayload(
      eventType,
      payload,
      instanceName || undefined,
    );
  } catch {
    // Continua sem normalização — não é crítico
  }

  // ── Insere no banco ────────────────────────────────────────────────────────
  const { data: event, error: insertError } = await supabaseServiceRole
    .from('evolution_webhook_events')
    .insert({
      env: 'prod',
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
    console.error('❌ [WEBHOOK PROD] Falha ao inserir evento:', insertError?.message);
    return;
  }

  // ── Auditoria de saída de participantes ───────────────────────────────────
  if (
    eventType === participantExitAuditService.EVENT_TYPE &&
    (payload?.data?.action === 'remove' || payload?.action === 'remove')
  ) {
    participantExitAuditService
      .recordParticipantExit(payload, instanceName)
      .catch((err) => {
        console.error('❌ [WEBHOOK PROD] Auditoria de saída:', err?.message || err);
      });
  }

  // ── Flows ─────────────────────────────────────────────────────────────────
  if (!normalizedPayload) return;

  // Tenta retomar flow aguardando resposta do usuário (nó Pergunta)
  const resumed = await flowExecutorService.tryResumePendingQuestionFromWebhookEvent(event.id);
  if (resumed) {
    console.log('✅ [WEBHOOK PROD] Flow retomado (nó Pergunta — resposta)');
    return;
  }

  const np = normalizedPayload;

  // Extrai groupJid para flows de participantes
  const groupJid =
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

  // group-participants.update → flow_instances (boas-vindas por grupo/usuário)
  if (
    (evtNorm === 'group-participants.update' ||
      String(eventType || '').toLowerCase().includes('participants')) &&
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
        console.error(`❌ [WEBHOOK PROD] Erro ao executar flow ${flow_id}:`, flowErr.message);
      }
    }
    return;
  }

  // Outros eventos (MESSAGES_UPSERT, GROUPS_UPSERT, etc.) → findMatchingFlows global
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
      console.error(`❌ [WEBHOOK PROD] Erro ao executar flow ${flow.id}:`, flowErr.message);
    }
  }
}

/**
 * POST /api/webhooks/evolution/prod
 *
 * Retorna 200 IMEDIATAMENTE após parsear o JSON.
 * Todo o processamento (INSERT no banco + execução de flows) é agendado via `after()`,
 * que garante execução após o response ser enviado — inclusive em ambientes serverless.
 *
 * Isso elimina o timeout que causava os 500s em cascata:
 * a Evolution API sempre recebe 200 em < 50ms, independente do estado do banco.
 */
export async function POST(req: NextRequest) {
  try {
    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Agenda processamento para DEPOIS do response (after = Next.js 15+)
    after(async () => {
      try {
        await processEventBackground(payload);
      } catch (err: any) {
        console.error('❌ [WEBHOOK PROD] Erro no processamento em background:', err?.message || err);
      }
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('❌ [WEBHOOK PROD] Erro ao parsear request:', err);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/webhooks/evolution/prod
 * Healthcheck — confirma que o endpoint está acessível.
 */
export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      env: 'prod',
      now: new Date().toISOString(),
      message: 'Webhook Evolution PROD está ativo',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
