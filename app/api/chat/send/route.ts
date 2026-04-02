/* 
 * CHAT API - REATIVADA
 * 
 * API para enviar mensagens via chat.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';
import { canUserAccessEvolutionChatInstance } from '@/lib/services/atendimento-chat-access';
import { messageIndicatesEvolutionSessionDropped, maybeMarkEvolutionInstanceDisconnected } from '@/lib/evolution/mark-instance-disconnected';

/** Código retornado ao cliente quando a Evolution não consegue enviar (instância/sessão caída). */
export const EVOLUTION_INSTANCE_UNREACHABLE_CODE = 'EVOLUTION_INSTANCE_UNREACHABLE';

function isEvolutionInstanceUnreachableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return messageIndicatesEvolutionSessionDropped(msg);
}

function normalizeEvolutionRemoteJid(rawRemoteJid: string): string {
  const input = String(rawRemoteJid || '').trim();
  const isGroup = input.endsWith('@g.us');
  const digits = input.replace(/@s\.whatsapp\.net$|@g\.us$/i, '').replace(/\D/g, '');
  if (!digits) return input;
  const normalizedNumber =
    !digits.startsWith('55') && (digits.length === 10 || digits.length === 11)
      ? `55${digits}`
      : digits;
  return `${normalizedNumber}${isGroup ? '@g.us' : '@s.whatsapp.net'}`;
}

/**
 * POST /api/chat/send
 * Envia mensagem via Evolution API e salva no banco
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
    const body = await req.json();
    const { instance_id, remoteJid, type, text, media, mimetype, mediatype, caption, fileName } = body;
    const normalizedRemoteJid = normalizeEvolutionRemoteJid(remoteJid);

    if (!instance_id || !remoteJid || !type) {
      return errorResponse('instance_id, remoteJid e type são obrigatórios', 400);
    }

    // 1. Buscar a instância e validar acesso
    const { data: instance, error: instError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis (
          base_url
        )
      `)
      .eq('id', instance_id)
      .single();

    if (instError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    // Validação multi-tenant: dono da instância ou admin/super_admin/suporte
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canSend =
      profile?.status === 'admin' ||
      profile?.status === 'super_admin' ||
      profile?.status === 'suporte';
    if (!canSend) {
      if (instance.user_id !== userId) {
        const allowed = await canUserAccessEvolutionChatInstance(userId, profile || {}, instance_id);
        if (!allowed) {
          return errorResponse('Acesso negado a esta instância.', 403);
        }
      }
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.base_url || !instance.apikey) {
      return errorResponse('Configuração da instância incompleta na Evolution API', 400);
    }

    // 2. Enviar via Evolution API usando token da instância
    try {
      const evolutionRes = await chatService.sendMessage(
        {
          instance_name: instance.instance_name,
          apikey: instance.apikey,
          base_url: evolutionApi.base_url,
        },
        {
          remoteJid: normalizedRemoteJid,
          type,
          text,
          media,
          mimetype,
          mediatype,
          caption,
          fileName,
        }
      );

      const returnedMessageId =
        evolutionRes?.key?.id ||
        evolutionRes?.messageId ||
        evolutionRes?.id ||
        evolutionRes?.data?.key?.id ||
        evolutionRes?.data?.messageId ||
        null;

      if (!returnedMessageId) {
        throw new Error(`Resposta inválida da Evolution (sem message id): ${JSON.stringify(evolutionRes)}`);
      }

      // 3. Salvar mensagem como "pendente/enviada" no banco
      // A confirmação final virá pelo webhook SEND_MESSAGE
      const messageId = returnedMessageId;
      
      // Buscar ou criar conversa
      const conversationData = {
        instance_id: instance.id,
        workspace_id: instance.workspace_id,
        user_id: instance.user_id,
        remote_jid: normalizedRemoteJid,
        last_message_at: new Date().toISOString(),
        last_message_preview: text || caption || (type === 'media' ? `Mídia: ${mediatype}` : ''),
        is_group: normalizedRemoteJid.endsWith('@g.us'),
      };
      
      const conversation = await chatService.upsertConversation(conversationData);

      const messageData = {
        instance_id: instance.id,
        workspace_id: instance.workspace_id,
        user_id: instance.user_id,
        conversation_id: conversation.id,
        message_id: messageId,
        direction: 'out' as const,
        from_me: true,
        sender_jid: instance.phone_number || 'me',
        text: text || '',
        media_type: type === 'media' ? mediatype : 'text',
        media_url: media || null,
        caption: caption || '',
        status: 'pending',
        timestamp: Math.floor(Date.now() / 1000),
      };

      const savedMessage = await chatService.saveMessage(messageData);

      return successResponse({
        evolution_res: evolutionRes,
        message: savedMessage
      }, 'Mensagem enviada com sucesso');

    } catch (sendErr: unknown) {
      console.error('Erro ao enviar mensagem pela Evolution:', sendErr);
      const errText = sendErr instanceof Error ? sendErr.message : String(sendErr);
      await maybeMarkEvolutionInstanceDisconnected(supabaseServiceRole, instance.id, errText, 'chat/send');
      if (isEvolutionInstanceUnreachableError(sendErr)) {
        return errorResponse(
          'A instância WhatsApp está desconectada ou indisponível no momento. Selecione outra instância ou reconecte esta em Instâncias WhatsApp.',
          503,
          { code: EVOLUTION_INSTANCE_UNREACHABLE_CODE }
        );
      }
      const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
      return errorResponse(`Falha ao enviar mensagem: ${message}`, 500);
    }

  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

