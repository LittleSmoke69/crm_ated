import { NextRequest, after } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveZaplotoIdFromWebhookRequest } from '@/lib/server/webhook-zaploto-context';
import { normalizationService } from '@/lib/services/normalization-service';
import { flowExecutorService } from '@/lib/services/flow-executor-service';
import { participantExitAuditService } from '@/lib/services/participant-exit-audit-service';
import { EVOLUTION_GROUP_PARTICIPANT_EVENT_TYPES } from '@/lib/utils/evolution-group-participant-event-types';
import { processEventForAntiSpam } from '@/lib/anti-spam/antiSpamWorker';

/** Janela de deduplicação de eventos group-participants: 30 segundos */
const PARTICIPANT_DEDUP_WINDOW_MS = 30_000;

/** Evita payloads enormes (memória + parse) sem tocar o banco. */
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Dedup pós-insert: sem limite, uma janela de 30s com muitos eventos no mesmo grupo
 * puxava milhares de linhas e derrubava o Postgres / estourava tempo da função (500).
 */
const POST_INSERT_DEDUP_LIMIT = 120;

export const runtime = 'nodejs';
/** Dá tempo ao `after()` terminar inserts/flows sem a plataforma matar a invocação com 500. */
export const maxDuration = 60;

/**
 * Extrai o ID do primeiro participante do payload (mantido para dedup pós-insert)
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
 * Extrai IDs de TODOS os participantes do payload, ordenados.
 * Usado na dedup pré-insert para garantir que eventos com participantes diferentes
 * não sejam incorretamente descartados.
 */
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

/**
 * Gera fingerprint único para deduplicação: instance + group + participant
 */
function generateParticipantFingerprint(
  instanceName: string,
  remoteJid: string,
  participantId: string | null
): string {
  const parts = [instanceName, remoteJid];
  if (participantId) {
    parts.push(participantId);
  }
  return parts.join('|');
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

  // group-participants: grupo vem em data.id (deve ser @g.us)
  // mensagens: vem em data.key.remoteJid
  // Prefere valor @g.us para data.id; caso contrário ignora (pode ser @lid ou hash)
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

/**
 * Processamento completo do evento: insert no banco + disparo de flows.
 * Executado via `after()` — APÓS o response 200 já ter sido enviado.
 * Nunca bloqueia a resposta da Evolution API.
 */
type WebhookProcessOpts = { zaplotoId: string | null };

async function processEventBackground(
  payload: any,
  opts: WebhookProcessOpts
): Promise<void> {
  const { zaplotoId } = opts;
  const { eventType, instanceName, messageId, remoteJid } = extractMetadata(payload);
  const evtNorm = String(eventType).toLowerCase().replace(/_/g, '-');
  const isGroupParticipants =
    evtNorm === 'group-participants.update' || evtNorm === 'group-participants-update';
  const actionRaw = String(payload?.data?.action ?? payload?.action ?? '').toLowerCase();

  // ── Deduplicação pré-insert de group-participants ──────────────────────────
  // Camada 1: fast-path — compara o conjunto completo de participantes (não só o primeiro)
  // para evitar descartar eventos com participantes distintos dentro da janela de 30s.
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
      const preDup = zaplotoId
        ? preDupBase.eq('zaploto_id', zaplotoId)
        : preDupBase.is('zaploto_id', null);
      const { data: existing } = await preDup
        .order('created_at', { ascending: false })
        .limit(20);

      if (existing && existing.length > 0) {
        for (const evt of existing) {
          const existingKey = extractAllParticipantIds(evt.payload).join(',');
          if (existingKey && existingKey === incomingKey) {
            console.log(
              `⚠️ [WEBHOOK PROD] group-participants duplicado (pré-insert) — instância=${instanceName} grupo=${remoteJid} participantes=[${incomingKey}] (evento existente: ${evt.id})`,
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
      `⚠️ [WEBHOOK PROD] Falha na normalização (usando payload original como fallback):`,
      err?.message || err,
    );
    // Continua sem normalização — usaremos payload original como fallback
  }

  // ── Insere no banco (com retry para erros de rede transitórios) ───────────
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
        payload: payload,
        payload_normalized: normalizedPayload || null,
        zaploto_id: zaplotoId,
      })
      .select('id, env, instance_name, payload, payload_normalized')
      .single();

    event = result.data;
    insertError = result.error;

    if (!insertError) break;

    // Duplicata: não retenta — comportamento idempotente esperado.
    if (insertError.code === '23505') break;

    const emsg = String(insertError.message || '').toLowerCase();
    const isNetworkError =
      emsg.includes('fetch failed') ||
      emsg.includes('econnrefused') ||
      emsg.includes('econnreset') ||
      emsg.includes('etimedout') ||
      emsg.includes('enotfound') ||
      emsg.includes('connection timed out') ||
      emsg.includes('522');

    if (!isNetworkError || attempt === INSERT_MAX_RETRIES) break;

    console.warn(`⚠️ [WEBHOOK PROD] Retry insert (tentativa ${attempt}/${INSERT_MAX_RETRIES}): ${insertError.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }

  if (insertError || !event) {
    // Violação de unique constraint: evento já foi inserido numa entrega anterior — comportamento esperado e idempotente.
    if (insertError?.code === '23505') {
      console.warn(
        `⚠️ [WEBHOOK PROD] Evento duplicado ignorado (message_id=${messageId}, instance=${instanceName})`,
      );
      return;
    }
    console.error('❌ [WEBHOOK PROD] Falha ao inserir evento:', insertError?.message);
    return;
  }

  // ── Dedup pós-insert para group-participants (protege contra race condition) ──
  // Camada 2: quando dois webhooks chegam quase simultaneamente, ambos passam
  // pela dedup pré-insert. Aqui verificamos qual foi o PRIMEIRO inserido na
  // janela para o MESMO participante — apenas ele prossegue para executar o flow.
  // Não filtra por env: protege também contra double-trigger prod+test.
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
      const postDup = zaplotoId
        ? postDupBase.eq('zaploto_id', zaplotoId)
        : postDupBase.is('zaploto_id', null);
      const { data: recentEvents } = await postDup
        .order('created_at', { ascending: true })
        .limit(POST_INSERT_DEDUP_LIMIT);

      if (recentEvents && recentEvents.length > 0) {
        for (const evt of recentEvents) {
          if (evt.id === event.id) continue;
          const evtKey = extractAllParticipantIds(evt.payload).join(',');
          if (evtKey && evtKey === incomingKey) {
            console.log(
              `⚠️ [WEBHOOK PROD] Post-insert dedup: evento ${event.id} ignorado (participantes=[${incomingKey}] já processados em ${evt.id})`,
            );
            return;
          }
        }
      }
    }
  }

  // ── Anti-Spam (processamento em tempo real) ──────────────────────────────
  if (isGroupParticipants || evtNorm === 'messages.upsert' || evtNorm === 'messages-upsert') {
    processEventForAntiSpam(payload, normalizedPayload, eventType, instanceName, remoteJid, event.id)
      .catch((err) => {
        console.error('❌ [WEBHOOK PROD] Erro anti-spam:', err?.message || err);
      });
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
  // Usa payload normalizado se disponível, senão usa payload original como fallback
  const np = normalizedPayload || payload;
  
  if (!np) {
    console.error('❌ [WEBHOOK PROD] Sem payload disponível (normalizado ou original) para processar flows');
    return;
  }

  // Log quando usando fallback
  if (!normalizedPayload && normalizationError) {
    console.warn(
      `⚠️ [WEBHOOK PROD] Processando flows com payload original (normalização falhou):`,
      normalizationError?.message || 'Erro desconhecido',
    );
  }

  // Tenta retomar flow aguardando resposta do usuário (nó Pergunta)
  const resumed = await flowExecutorService.tryResumePendingQuestionFromWebhookEvent(event.id);
  if (resumed) {
    console.log('✅ [WEBHOOK PROD] Flow retomado (nó Pergunta — resposta)');
    return;
  }

  // Extrai groupJid para flows de participantes — percorre candidatos e usa o primeiro @g.us válido.
  // Evita capturar @lid, @s.whatsapp.net ou hashes hexadecimais que podem estar em data.id.
  const groupJidCandidates = [
    payload?.data?.id,
    np?.data?.id,
    np?.normalized?.groupId,
    np?.normalized?.group_id,
    np?.groupId,
    np?.group_id,
    payload?.data?.key?.remoteJid,
    payload?.data?.groupJid,
    remoteJid,
  ];
  const groupJid = groupJidCandidates.find(
    (v) => v && typeof v === 'string' && v.endsWith('@g.us'),
  ) ?? null;

  if (isGroupParticipants && !groupJid) {
    console.warn(
      `⚠️ [WEBHOOK PROD] group-participants sem groupJid @g.us válido (instância=${instanceName}). Candidatos: ${groupJidCandidates.filter(Boolean).join(', ')}`,
    );
  }

  // group-participants.update → flow_instances (boas-vindas por grupo/usuário)
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
    const zaplotoId = await resolveZaplotoIdFromWebhookRequest(req);
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

    // Retorna a Promise para o Next manter a invocação até o fim do trabalho (evita 500 por corte prematuro).
    after(() =>
      processEventBackground(payload, { zaplotoId }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('❌ [WEBHOOK PROD] Erro no processamento em background:', msg);
      }),
    );

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
