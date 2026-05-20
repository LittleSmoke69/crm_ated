/**
 * Lógica de processamento de webhook Evolution.
 * Compartilhada entre o route.ts (modo after()) e o webhook-queue-worker.ts (modo fila).
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizationService } from '@/lib/services/normalization-service';
import { flowExecutorService } from '@/lib/services/flow-executor-service';
import { participantExitAuditService } from '@/lib/services/participant-exit-audit-service';
import { EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES } from '@/lib/utils/evolution-group-participant-event-types';
import { processEventForAntiSpam } from '@/lib/anti-spam/antiSpamWorker';

const PARTICIPANT_DEDUP_WINDOW_MS = 30_000;
const POST_INSERT_DEDUP_LIMIT = 120;

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

function extractAllParticipantIds(payload: any): string[] {
  const participants: any[] = payload?.data?.participants ?? [];
  const ids: string[] = [];
  for (const p of participants) {
    const id = String(
      p?.id ?? p?.phoneNumber ?? (typeof p === 'string' ? p : '') ?? '',
    ).trim();
    if (id) ids.push(id);
  }
  return ids.sort();
}

export function extractMetadata(payload: any) {
  const eventType =
    payload?.event || payload?.type || payload?.data?.event || 'unknown';
  const instanceName =
    payload?.instance?.instanceName || payload?.instanceName || payload?.instance || null;
  const messageId =
    payload?.data?.key?.id || payload?.data?.message?.key?.id || payload?.key?.id || payload?.id || null;
  const dataId = payload?.data?.id;
  const dataIdAsGroup = dataId && typeof dataId === 'string' && dataId.endsWith('@g.us') ? dataId : null;
  const remoteJid =
    dataIdAsGroup ||
    payload?.data?.key?.remoteJid ||
    payload?.data?.message?.key?.remoteJid ||
    payload?.key?.remoteJid ||
    payload?.remoteJid ||
    payload?.data?.groupJid ||
    (dataId && typeof dataId === 'string' ? dataId : null) ||
    null;
  return { eventType, instanceName, messageId, remoteJid };
}

export type WebhookProcessOpts = { zaplotoId: string | null };

export async function processWebhookEvent(payload: any, opts: WebhookProcessOpts): Promise<void> {
  const { zaplotoId } = opts;
  const { eventType, instanceName, messageId, remoteJid } = extractMetadata(payload);
  const evtNorm = String(eventType).toLowerCase().replace(/_/g, '-');
  const isGroupParticipants =
    evtNorm === 'group-participants.update' || evtNorm === 'group-participants-update';
  const actionRaw = String(payload?.data?.action ?? payload?.action ?? '').toLowerCase();

  // Deduplicação pré-insert de group-participants
  if (isGroupParticipants && actionRaw === 'add' && instanceName && remoteJid) {
    const incomingParticipants = extractAllParticipantIds(payload);
    if (incomingParticipants.length > 0) {
      const incomingKey = incomingParticipants.join(',');
      const since = new Date(Date.now() - PARTICIPANT_DEDUP_WINDOW_MS).toISOString();
      const preDupBase = supabaseServiceRole
        .from('evolution_webhook_events')
        .select('id, payload')
        .eq('instance_name', instanceName)
        .eq('remote_jid', remoteJid)
        .in('event_type', EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES)
        .gte('created_at', since);
      const preDup = zaplotoId ? preDupBase.eq('zaploto_id', zaplotoId) : preDupBase.is('zaploto_id', null);
      const { data: existing } = await preDup.order('created_at', { ascending: false }).limit(20);
      if (existing && existing.length > 0) {
        for (const evt of existing) {
          const existingKey = extractAllParticipantIds(evt.payload).join(',');
          if (existingKey && existingKey === incomingKey) {
            console.log(`⚠️ [WEBHOOK] group-participants duplicado (pré-insert) — instância=${instanceName}`);
            return;
          }
        }
      }
    }
  }

  // Normalização
  let normalizedPayload: any = null;
  let normalizationError: any = null;
  try {
    normalizedPayload = await normalizationService.normalizePayload(
      eventType, payload, instanceName || undefined, { ruleFetchMaxAttempts: 1 },
    );
  } catch (err: any) {
    normalizationError = err;
    console.warn(`⚠️ [WEBHOOK] Falha na normalização:`, err?.message || err);
  }

  // Insert com retry
  const INSERT_MAX_RETRIES = 3;
  let event: { id: string; env: string; instance_name: string | null; payload: any; payload_normalized: any } | null = null;
  let insertError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= INSERT_MAX_RETRIES; attempt++) {
    const result = await supabaseServiceRole
      .from('evolution_webhook_events')
      .insert({
        env: 'prod',
        event_type: eventType,
        instance_name: instanceName,
        remote_jid: remoteJid,
        message_id: messageId,
        payload,
        payload_normalized: normalizedPayload || null,
        zaploto_id: zaplotoId,
      })
      .select('id, env, instance_name, payload, payload_normalized')
      .single();

    event = result.data;
    insertError = result.error;
    if (!insertError) break;
    if (insertError.code === '23505') break;

    const emsg = String(insertError.message || '').toLowerCase();
    const isNetworkError =
      emsg.includes('fetch failed') || emsg.includes('econnrefused') ||
      emsg.includes('econnreset') || emsg.includes('etimedout') ||
      emsg.includes('enotfound') || emsg.includes('connection timed out') || emsg.includes('522');

    if (!isNetworkError || attempt === INSERT_MAX_RETRIES) break;
    console.warn(`⚠️ [WEBHOOK] Retry insert (tentativa ${attempt}/${INSERT_MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }

  if (insertError || !event) {
    if (insertError?.code === '23505') {
      console.warn(`⚠️ [WEBHOOK] Evento duplicado ignorado (message_id=${messageId}, instance=${instanceName})`);
      return;
    }
    console.error('❌ [WEBHOOK] Falha ao inserir evento:', insertError?.message);
    return;
  }

  // Dedup pós-insert para group-participants
  if (isGroupParticipants && actionRaw === 'add' && instanceName && remoteJid) {
    const incomingKey = extractAllParticipantIds(payload).join(',');
    if (incomingKey) {
      const dedupSince = new Date(Date.now() - PARTICIPANT_DEDUP_WINDOW_MS).toISOString();
      const postDupBase = supabaseServiceRole
        .from('evolution_webhook_events')
        .select('id, payload')
        .eq('instance_name', instanceName)
        .eq('remote_jid', remoteJid)
        .in('event_type', EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES)
        .gte('created_at', dedupSince);
      const postDup = zaplotoId ? postDupBase.eq('zaploto_id', zaplotoId) : postDupBase.is('zaploto_id', null);
      const { data: recentEvents } = await postDup.order('created_at', { ascending: true }).limit(POST_INSERT_DEDUP_LIMIT);
      if (recentEvents && recentEvents.length > 0) {
        for (const evt of recentEvents) {
          if (evt.id === event.id) continue;
          const evtKey = extractAllParticipantIds(evt.payload).join(',');
          if (evtKey && evtKey === incomingKey) {
            console.log(`⚠️ [WEBHOOK] Post-insert dedup: evento ${event.id} ignorado`);
            return;
          }
        }
      }
    }
  }

  // Anti-Spam
  if (isGroupParticipants || evtNorm === 'messages.upsert' || evtNorm === 'messages-upsert') {
    processEventForAntiSpam(payload, normalizedPayload, eventType, instanceName, remoteJid, event.id)
      .catch((err) => console.error('❌ [WEBHOOK] Erro anti-spam:', err?.message || err));
  }

  // Auditoria de saída de participantes
  if (
    eventType === participantExitAuditService.EVENT_TYPE &&
    (payload?.data?.action === 'remove' || payload?.action === 'remove')
  ) {
    participantExitAuditService.recordParticipantExit(payload, instanceName)
      .catch((err) => console.error('❌ [WEBHOOK] Auditoria de saída:', err?.message || err));
  }

  // Flows
  const np = normalizedPayload || payload;
  if (!np) {
    console.error('❌ [WEBHOOK] Sem payload para processar flows');
    return;
  }

  const resumed = await flowExecutorService.tryResumePendingQuestionFromWebhookEvent(event.id);
  if (resumed) {
    console.log('✅ [WEBHOOK] Flow retomado (nó Pergunta)');
    return;
  }

  const groupJidCandidates = [
    payload?.data?.id, np?.data?.id, np?.normalized?.groupId, np?.normalized?.group_id,
    np?.groupId, np?.group_id, payload?.data?.key?.remoteJid, payload?.data?.groupJid, remoteJid,
  ];
  const groupJid = groupJidCandidates.find(
    (v) => v && typeof v === 'string' && v.endsWith('@g.us'),
  ) ?? null;

  if (
    (isGroupParticipants || String(eventType || '').toLowerCase().includes('participants')) &&
    instanceName && groupJid
  ) {
    const matching = await flowExecutorService.findMatchingFlowInstances(
      eventType, instanceName, String(groupJid), np,
    );
    for (const { flow_id, user_id, settings_json } of matching) {
      try {
        await flowExecutorService.executeFlow(flow_id, event.id, user_id, settings_json);
      } catch (flowErr: any) {
        console.error(`❌ [WEBHOOK] Erro ao executar flow ${flow_id}:`, flowErr.message);
      }
    }
    return;
  }

  const matchingFlows = await flowExecutorService.findMatchingFlows(eventType, instanceName, np);
  for (const flow of matchingFlows) {
    if (!flow.user_id) continue;
    try {
      await flowExecutorService.executeFlow(flow.id, event.id, flow.user_id);
    } catch (flowErr: any) {
      console.error(`❌ [WEBHOOK] Erro ao executar flow ${flow.id}:`, flowErr.message);
    }
  }
}
