/**
 * POST /api/chat/broadcast/[jobId]/process-next
 *
 * Processa o próximo envio: sequência de mensagens por contato (message_config.steps),
 * depois avança para o próximo contato. Intervalos: sequence_delay_seconds (entre
 * mensagens no mesmo contato) e delay_seconds / aleatório (entre contatos).
 *
 * Retorna { done, contact, success, error, current_index, total_count, next_delay_seconds, ... }
 *
 * Se a instância Evolution estiver offline, retorna { instanceDown: true }
 * sem avançar índice nem passo — o cliente deve pausar e tentar novamente depois.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import { messageIndicatesEvolutionSessionDropped, maybeMarkEvolutionInstanceDisconnected } from '@/lib/evolution/mark-instance-disconnected';
import { computeNextDelaySeconds } from '@/lib/chat/broadcast-delay';
import { getSequenceDelaySeconds, parseBroadcastSteps } from '@/lib/chat/broadcast-sequence';

function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const withCountry = !digits.startsWith('55') && (digits.length === 10 || digits.length === 11)
    ? `55${digits}`
    : digits;
  return `${withCountry}@s.whatsapp.net`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { jobId } = await params;

    const { data: job, error: jobError } = await supabaseServiceRole
      .from('chat_broadcasts')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (jobError || !job) return errorResponse('Broadcast não encontrado', 404);
    if (job.status === 'cancelled') return errorResponse('Broadcast cancelado', 400);
    if (job.status === 'paused') return successResponse({ done: false, paused: true }, 'Broadcast pausado');

    const steps = parseBroadcastSteps(job.message_config);
    if (steps.length === 0) {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({
          status: 'failed',
          last_error: 'message_config sem mensagens válidas',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      return errorResponse('Configuração de mensagens inválida', 400);
    }

    const contacts = job.contacts as { phone: string; name?: string }[];
    const idx: number = job.current_index;

    let stepIdx = Number(job.message_step_index);
    if (!Number.isFinite(stepIdx) || stepIdx < 0) stepIdx = 0;
    if (stepIdx >= steps.length) stepIdx = 0;

    const delayBetweenContacts = () => ({ next_delay_seconds: computeNextDelaySeconds(job) });
    const delayBetweenSequence = () => ({ next_delay_seconds: getSequenceDelaySeconds(job.message_config) });

    if (idx >= job.total_count || idx >= contacts.length) {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', jobId);
      return successResponse({ done: true, current_index: idx, total_count: job.total_count }, 'Disparo concluído');
    }

    const rawRotation = job.broadcast_instances as { id: string; name?: string }[] | null;
    const rotation =
      Array.isArray(rawRotation) && rawRotation.length > 0
        ? rawRotation
        : [{ id: job.instance_id as string, name: job.instance_name as string }];
    const pick = rotation[idx % rotation.length];
    const instanceUuid = pick?.id || job.instance_id;

    const contact = contacts[idx];
    const remoteJid = normalizePhone(contact.phone);
    if (!remoteJid) {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({
          current_index: idx + 1,
          message_step_index: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      return successResponse(
        {
          done: false,
          skipped: true,
          current_index: idx + 1,
          total_count: job.total_count,
          message_step_index: 0,
          message_steps_total: steps.length,
          ...delayBetweenContacts(),
        },
        'Contato inválido — pulado'
      );
    }

    const { data: instance } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, apikey, phone_number, workspace_id, user_id, evolution_apis(base_url)')
      .eq('id', instanceUuid)
      .single();

    if (!instance) return errorResponse('Instância não encontrada', 404);

    const evolutionApi = Array.isArray(instance.evolution_apis)
      ? instance.evolution_apis[0]
      : instance.evolution_apis;

    if (!evolutionApi?.base_url || !instance.apikey) {
      return errorResponse('Configuração incompleta da Evolution API', 400);
    }

    if (job.status === 'pending') {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }

    const msgConfig = steps[stepIdx];

    let evolutionRes: Record<string, unknown> | null = null;
    let sendError: string | null = null;
    let instanceDown = false;

    try {
      evolutionRes = await chatService.sendMessage(
        {
          instance_name: instance.instance_name,
          apikey: instance.apikey,
          base_url: evolutionApi.base_url,
        },
        {
          remoteJid,
          type: msgConfig.type as 'text' | 'media',
          text: msgConfig.content,
          media: msgConfig.attachment_url,
          mimetype: msgConfig.mimetype,
          mediatype: msgConfig.type !== 'text' ? msgConfig.type : undefined,
          caption: msgConfig.caption,
          fileName: msgConfig.fileName,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError = msg;
      await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instance.id, msg, 'chat/broadcast');
      instanceDown =
        messageIndicatesEvolutionSessionDropped(msg) ||
        /timeout|ECONNREFUSED|ENOTFOUND|network|socket|offline|disconnected/i.test(msg);
    }

    if (sendError) {
      if (instanceDown) {
        await supabaseServiceRole
          .from('chat_broadcasts')
          .update({ last_error: sendError, updated_at: new Date().toISOString() })
          .eq('id', jobId);
        return successResponse({
          done: false,
          instanceDown: true,
          current_index: idx,
          total_count: job.total_count,
          message_step_index: stepIdx,
          message_steps_total: steps.length,
          error: sendError,
        }, 'Instância offline — disparo pausado no mesmo número');
      }

      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({
          current_index: idx + 1,
          message_step_index: 0,
          last_error: sendError,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      return successResponse({
        done: false,
        skipped: true,
        current_index: idx + 1,
        total_count: job.total_count,
        message_step_index: 0,
        message_steps_total: steps.length,
        error: sendError,
        ...delayBetweenContacts(),
      });
    }

    try {
      const mediaLabels: Record<string, string> = { audio: '🎵 Áudio', video: '🎬 Vídeo', image: '🖼️ Imagem', document: '📄 Documento' };
      const previewText =
        msgConfig.content?.substring(0, 100) ||
        msgConfig.caption?.substring(0, 100) ||
        mediaLabels[msgConfig.type] ||
        '[Mídia]';

      const conversation = await chatService.upsertConversation({
        instance_id: instance.id,
        workspace_id: instance.workspace_id ?? undefined,
        user_id: instance.user_id ?? undefined,
        remote_jid: remoteJid,
        title: contact.name || remoteJid.replace('@s.whatsapp.net', ''),
        is_group: false,
        last_message_at: new Date().toISOString(),
        last_message_preview: previewText,
      });

      const returnedMessageId =
        (evolutionRes as Record<string, Record<string, string>> | null)?.key?.id ||
        (evolutionRes as Record<string, string> | null)?.messageId ||
        (evolutionRes as Record<string, string> | null)?.id ||
        null;

      if (returnedMessageId && conversation?.id) {
        await chatService.saveMessage({
          instance_id: instance.id,
          workspace_id: instance.workspace_id ?? undefined,
          user_id: instance.user_id ?? undefined,
          conversation_id: conversation.id,
          message_id: String(returnedMessageId),
          direction: 'out',
          from_me: true,
          sender_jid: instance.phone_number || 'me',
          text: msgConfig.content || '',
          media_type: msgConfig.type !== 'text' ? (msgConfig.type as 'audio' | 'video' | 'image' | 'document') : 'text',
          media_url: msgConfig.attachment_url || undefined,
          caption: msgConfig.caption || '',
          status: 'pending',
          timestamp: Math.floor(Date.now() / 1000),
        });
      }
    } catch {
      // saveMessage failure não deve parar o disparo
    }

    const moreStepsOnSameContact = stepIdx < steps.length - 1;
    const nowIso = new Date().toISOString();

    if (moreStepsOnSameContact) {
      const nextStep = stepIdx + 1;
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({
          message_step_index: nextStep,
          last_sent_at: nowIso,
          status: 'running',
          last_error: null,
          updated_at: nowIso,
        })
        .eq('id', jobId);

      return successResponse({
        done: false,
        success: true,
        contact: { phone: contact.phone, name: contact.name },
        current_index: idx,
        total_count: job.total_count,
        message_step_index: nextStep,
        message_steps_total: steps.length,
        same_contact_continue: true,
        ...delayBetweenSequence(),
      }, 'Mensagem enviada (sequência)');
    }

    const nextContactIdx = idx + 1;
    const isDone = nextContactIdx >= job.total_count;

    await supabaseServiceRole
      .from('chat_broadcasts')
      .update({
        current_index: nextContactIdx,
        message_step_index: 0,
        last_sent_at: nowIso,
        status: isDone ? 'completed' : 'running',
        completed_at: isDone ? nowIso : null,
        last_error: null,
        updated_at: nowIso,
      })
      .eq('id', jobId);

    return successResponse({
      done: isDone,
      success: true,
      contact: { phone: contact.phone, name: contact.name },
      current_index: nextContactIdx,
      total_count: job.total_count,
      message_step_index: 0,
      message_steps_total: steps.length,
      same_contact_continue: false,
      ...delayBetweenContacts(),
    }, isDone ? 'Disparo concluído' : 'Mensagem enviada');
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
