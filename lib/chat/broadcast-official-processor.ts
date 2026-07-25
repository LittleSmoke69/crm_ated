/**
 * Processa 1 passo de um job de disparo em massa via WhatsApp Oficial (templates Meta).
 * Chamado por POST /api/chat/broadcast/[jobId]/process-next quando
 * chat_broadcasts.channel_type = 'whatsapp_official'. Reaproveita a mesma tabela/fila
 * e o mesmo mecanismo de step-claim do disparo via Evolution, mas sem rotação de
 * instância nem sequência de mensagens (1 template por contato).
 */
import { NextResponse } from 'next/server';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import * as whatsappOfficial from '@/lib/services/whatsapp-official-service';
import { computeNextDelaySeconds } from './broadcast-delay';
import { releaseBroadcastStepClaim, tryClaimBroadcastStep } from './broadcast-step-claim';
import { resolveWhatsAppOfficialConversationUserIdForUpsert } from './resolve-evolution-conversation-user-id';

interface OfficialBroadcastMessageConfig {
  template_name: string;
  template_language: string;
  template_params: string[];
  /** Corpo aprovado do template (com {{1}}, {{2}}...), salvo na criação do job para render sem reconsultar a Meta. */
  template_body_pattern?: string;
}

function renderBody(pattern: string, values: string[]): string {
  let out = pattern;
  values.forEach((v, i) => {
    out = out.split(`{{${i + 1}}}`).join(v || `{{${i + 1}}}`);
  });
  return out;
}

/** Substitui o token {{nome}} (em qualquer variável) pelo nome do contato do CSV, se houver. */
function personalizeParams(params: string[], contactName: string | undefined, fallback: string): string[] {
  const name = (contactName || '').trim() || fallback;
  return params.map((p) => p.replace(/\{\{\s*nome\s*\}\}/gi, name));
}

function looksLikeAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('oauthexception') || m.includes('190') || m.includes('access token') || m.includes('401');
}

export async function processOfficialBroadcastStep(
  jobId: string,
  job: Record<string, unknown>
): Promise<NextResponse> {
  let stepClaimToken: string | undefined;
  try {
    if (job.status === 'cancelled') return errorResponse('Broadcast cancelado', 400);
    if (job.status === 'paused') return successResponse({ done: false, paused: true }, 'Broadcast pausado');

    const totalCount = Number(job.total_count) || 0;
    const idx = Number(job.current_index) || 0;
    const contacts = (job.contacts as { phone: string; name?: string }[]) || [];

    if (idx >= totalCount || idx >= contacts.length) {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', jobId);
      return successResponse({ done: true, current_index: idx, total_count: totalCount }, 'Disparo concluído');
    }

    const config = job.whatsapp_config_id
      ? (
          await supabaseServiceRole
            .from('whatsapp_official_configs')
            .select('id, phone_number_id, waba_id, graph_version, access_token')
            .eq('id', job.whatsapp_config_id as string)
            .maybeSingle()
        ).data
      : null;
    if (!config) {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({ status: 'failed', last_error: 'Configuração WhatsApp Oficial não encontrada', updated_at: new Date().toISOString() })
        .eq('id', jobId);
      return errorResponse('Configuração WhatsApp Oficial não encontrada', 404);
    }

    const contact = contacts[idx];
    const normalizedPhone = String(contact?.phone || '').replace(/\D/g, '');
    if (!normalizedPhone) {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({ current_index: idx + 1, updated_at: new Date().toISOString() })
        .eq('id', jobId);
      return successResponse(
        { done: false, skipped: true, error: 'Telefone inválido', current_index: idx + 1, total_count: totalCount, next_delay_seconds: computeNextDelaySeconds(job) },
        'Contato inválido — pulado'
      );
    }

    if (job.status === 'pending') {
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }

    const claimTry = await tryClaimBroadcastStep(supabaseServiceRole, jobId, idx, 0);
    if (!claimTry.ok) {
      return successResponse(
        { done: false, duplicateSuppressed: true, current_index: idx, total_count: totalCount, next_delay_seconds: 0 },
        'Passo já em processamento'
      );
    }
    stepClaimToken = claimTry.claimToken;

    const msgConfig = job.message_config as OfficialBroadcastMessageConfig;
    const rawParams = Array.isArray(msgConfig?.template_params) ? msgConfig.template_params : [];
    const personalizedParams = personalizeParams(rawParams, contact?.name, normalizedPhone);
    const components =
      personalizedParams.length > 0
        ? [{ type: 'body' as const, parameters: personalizedParams.map((t) => ({ type: 'text' as const, text: t })) }]
        : undefined;

    let externalMessageId: string;
    try {
      const res = await whatsappOfficial.sendTemplate(
        { id: config.id, phone_number_id: config.phone_number_id, waba_id: config.waba_id, graph_version: config.graph_version, access_token: config.access_token },
        normalizedPhone,
        { name: msgConfig.template_name, language: msgConfig.template_language, components }
      );
      externalMessageId = res.messages[0].id;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (looksLikeAuthError(message)) {
        await releaseBroadcastStepClaim(supabaseServiceRole, jobId, stepClaimToken);
        await supabaseServiceRole
          .from('chat_broadcasts')
          .update({ status: 'paused', last_error: message, updated_at: new Date().toISOString() })
          .eq('id', jobId);
        return successResponse(
          { done: false, instanceDown: true, current_index: idx, total_count: totalCount, error: message },
          'Token/config inválidos — disparo pausado'
        );
      }
      await supabaseServiceRole
        .from('chat_broadcasts')
        .update({
          current_index: idx + 1,
          last_error: message,
          step_claim_token: null,
          step_claim_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('step_claim_token', stepClaimToken);
      return successResponse(
        { done: false, skipped: true, current_index: idx + 1, total_count: totalCount, error: message, next_delay_seconds: computeNextDelaySeconds(job) },
        'Falha ao enviar — contato pulado'
      );
    }

    const remoteJid = `${normalizedPhone}@s.whatsapp.net`;
    const renderedText = msgConfig.template_body_pattern
      ? renderBody(msgConfig.template_body_pattern, personalizedParams)
      : msgConfig.template_name;

    try {
      // Preserva o dono já gravado da conversa (contato já em atendimento com outro
      // agente) — só atribui ao dono do disparo quando a conversa é nova.
      const conversationUserId = await resolveWhatsAppOfficialConversationUserIdForUpsert(
        supabaseServiceRole,
        config.id,
        remoteJid,
        job.user_id as string
      );

      const conversation = await chatService.upsertConversation({
        whatsapp_config_id: config.id,
        instance_id: null,
        workspace_id: (job.workspace_id as string | undefined) ?? undefined,
        user_id: conversationUserId,
        remote_jid: remoteJid,
        title: contact?.name || normalizedPhone,
        is_group: false,
        last_message_at: new Date().toISOString(),
        last_message_preview: `Template: ${msgConfig.template_name}`,
      });
      await chatService.saveMessage({
        instance_id: null,
        whatsapp_config_id: config.id,
        workspace_id: (job.workspace_id as string | undefined) ?? undefined,
        user_id: job.user_id as string,
        conversation_id: conversation.id,
        message_id: externalMessageId,
        direction: 'out',
        from_me: true,
        sender_jid: config.phone_number_id,
        text: renderedText,
        media_type: 'template',
        template_name: msgConfig.template_name,
        template_language: msgConfig.template_language,
        template_components: components ?? null,
        status: 'sent',
        timestamp: Math.floor(Date.now() / 1000),
        provider: 'whatsapp_official',
      });
    } catch {
      // saveMessage/upsertConversation não deve derrubar o disparo — a mensagem já foi enviada na Meta
    }

    const nextIdx = idx + 1;
    const isDone = nextIdx >= totalCount;
    const nowIso = new Date().toISOString();

    await supabaseServiceRole
      .from('chat_broadcasts')
      .update({
        current_index: nextIdx,
        last_sent_at: nowIso,
        status: isDone ? 'completed' : 'running',
        completed_at: isDone ? nowIso : null,
        last_error: null,
        step_claim_token: null,
        step_claim_at: null,
        updated_at: nowIso,
      })
      .eq('id', jobId)
      .eq('step_claim_token', stepClaimToken);

    return successResponse(
      {
        done: isDone,
        success: true,
        contact: { phone: contact.phone, name: contact.name },
        current_index: nextIdx,
        total_count: totalCount,
        next_delay_seconds: computeNextDelaySeconds(job),
      },
      isDone ? 'Disparo concluído' : 'Template enviado'
    );
  } catch (err) {
    if (stepClaimToken) {
      await releaseBroadcastStepClaim(supabaseServiceRole, jobId, stepClaimToken);
    }
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    return errorResponse(message, 500);
  }
}
