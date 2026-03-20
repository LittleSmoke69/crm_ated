import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizationService } from '@/lib/services/normalization-service';
import { flowExecutorService } from '@/lib/services/flow-executor-service';
import { participantExitAuditService } from '@/lib/services/participant-exit-audit-service';

/**
 * POST /api/webhooks/evolution/test
 * Webhook para receber eventos da Evolution API (ambiente TEST)
 * 
 * Validação:
 * - Payload deve ser JSON válido
 * 
 * Ações:
 * - Salva evento em evolution_webhook_events com env='test'
 * - Atualiza waiters ativos se houver (sistema estilo n8n)
 * - Retorna 200 imediatamente (não bloqueia)
 */
export async function POST(req: NextRequest) {
  try {
    // Parse do JSON
    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Normalização de metadados
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

    // Para eventos group-participants.update, o ID do grupo vem em data.id
    // Para outros eventos (mensagens), vem em data.key.remoteJid
    const remoteJid = 
      payload?.data?.id ||  // ID do grupo em eventos group-participants.update
      payload?.data?.key?.remoteJid || 
      payload?.data?.message?.key?.remoteJid || 
      payload?.key?.remoteJid || 
      payload?.remoteJid || 
      payload?.data?.groupJid ||
      null;

    // Aplica normalização ao payload
    let normalizedPayload: any = null;
    try {
      normalizedPayload = await normalizationService.normalizePayload(
        eventType,
        payload,
        instanceName || undefined
      );
    } catch {
      // Continua mesmo com erro de normalização
    }

    // Insere evento no banco
    const { data: event, error } = await supabaseServiceRole
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
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ ok: true, warning: 'Event not saved' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Auditoria: registra saídas de participantes (group-participants.update action: remove)
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

    // Dispara flows ativos que correspondem ao evento (assíncrono, não bloqueia)
    if (normalizedPayload) {
      const runFlows = async () => {
        const resumed = await flowExecutorService.tryResumePendingQuestionFromWebhookEvent(event.id);
        if (resumed) {
          console.log('✅ [WEBHOOK TEST] Flow retomado (nó Pergunta — resposta)');
          return;
        }

        const np = normalizedPayload;
        
        // Extrai groupJid de múltiplos caminhos possíveis
        // Para group-participants.update, o ID do grupo vem em data.id
        const groupJid =
          // Prioriza payload original para eventos de participantes
          payload?.data?.id ??
          // Depois tenta payload normalizado
          np?.data?.id ??
          np?.normalized?.groupId ??
          np?.normalized?.group_id ??
          np?.groupId ??
          np?.group_id ??
          // Outros caminhos de fallback
          payload?.data?.key?.remoteJid ??
          payload?.data?.groupJid ??
          // Usa o remoteJid já extraído se for um grupo (@g.us)
          (remoteJid && String(remoteJid).includes('@g.us') ? remoteJid : null) ??
          null;

        if (
          (eventType === 'group-participants.update' || String(eventType || '').toLowerCase().includes('participants')) &&
          instanceName &&
          groupJid
        ) {
          const matching = await flowExecutorService.findMatchingFlowInstances(
            eventType,
            instanceName,
            String(groupJid),
            np
          );
          for (const { flow_id, user_id, settings_json } of matching) {
            try {
              await flowExecutorService.executeFlow(flow_id, event.id, user_id, settings_json);
            } catch (flowErr: any) {
              console.error(`❌ [WEBHOOK TEST] Erro ao executar flow ${flow_id}:`, flowErr);
            }
          }
          return;
        }

        const matchingFlows = await flowExecutorService.findMatchingFlows(
          eventType,
          instanceName,
          np
        );
        for (const flow of matchingFlows) {
          try {
            const flowUserId = flow.user_id;
            if (!flowUserId) continue;
            await flowExecutorService.executeFlow(flow.id, event.id, flowUserId);
          } catch (flowErr: any) {
            console.error(`❌ [WEBHOOK TEST] Erro ao executar flow ${flow.id}:`, flowErr);
          }
        }
      };

      runFlows().catch((err) => {
        console.error('❌ [WEBHOOK TEST] Erro ao processar flows:', err);
      });
    }

    // Verifica se há waiters ativos e atualiza o primeiro
    if (event.id) {
      const { data: activeWaiters } = await supabaseServiceRole
        .from('evolution_webhook_test_waiters')
        .select('id')
        .eq('status', 'waiting')
        .eq('env', 'test')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(1);

      if (activeWaiters && activeWaiters.length > 0) {
        const waiter = activeWaiters[0];
        await supabaseServiceRole
          .from('evolution_webhook_test_waiters')
          .update({
            status: 'received',
            received_event_id: event.id,
            received_at: new Date().toISOString(),
          })
          .eq('id', waiter.id);
      }
    }

    // Retorna sucesso imediatamente
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('❌ [WEBHOOK TEST] Erro inesperado:', err);
    // Retorna 200 para não bloquear a Evolution API mesmo em caso de erro inesperado
    return new Response(JSON.stringify({ ok: true, error: 'Internal error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * GET /api/webhooks/evolution/test
 * Healthcheck para validar se o endpoint está acessível
 */
export async function GET(req: NextRequest) {
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
    }
  );
}

