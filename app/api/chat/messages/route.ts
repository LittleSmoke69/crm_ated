/*
 * CHAT API - REATIVADA
 *
 * API para gerenciar mensagens do chat.
 * Suporta cursor-based pagination via before_timestamp para scroll infinito (carregar mais antigas).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { canUserAccessEvolutionChatInstance } from '@/lib/services/atendimento-chat-access';

/**
 * GET /api/chat/messages
 * Lista mensagens de uma conversa — carrega as mais recentes por padrão.
 *
 * Params:
 *   conversation_id  (obrigatório)
 *   limit            número de mensagens por página (default 50, max 100)
 *   before_timestamp timestamp Unix (bigint) — retorna mensagens ANTES desse ponto (scroll infinito para cima)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const conversation_id = searchParams.get('conversation_id');
    const before_timestamp = searchParams.get('before_timestamp');
    const include_siblings = searchParams.get('include_siblings') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    if (!conversation_id) {
      return errorResponse('conversation_id é obrigatório', 400);
    }

    // 1. Validar acesso à conversa
    const { data: conversation, error: convError } = await supabaseServiceRole
      .from('chat_conversations')
      .select('instance_id, whatsapp_config_id, user_id, gerente_id, workspace_id')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      return errorResponse('Conversa não encontrada', 404);
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdminOrSuporte =
      profile?.status === 'admin' ||
      profile?.status === 'super_admin' ||
      profile?.status === 'suporte';
    let canAccessEvolution = false;
    if (conversation.instance_id) {
      if (isAdminOrSuporte) {
        canAccessEvolution = true;
      } else if (conversation.user_id === userId) {
        canAccessEvolution = true;
      } else {
        canAccessEvolution = await canUserAccessEvolutionChatInstance(
          userId,
          profile || {},
          conversation.instance_id
        );
      }
    }
    const sameTenant = conversation.workspace_id === profile?.zaploto_id;
    const canAccessWhatsAppOfficial = !!conversation.whatsapp_config_id && (
      profile?.status === 'super_admin' ||
      (sameTenant && (
        isAdminOrSuporte ||
        (profile?.status === 'captador' && conversation.user_id === userId) ||
        (profile?.status === 'gerente' &&
          (conversation.gerente_id === userId || (!conversation.gerente_id && !conversation.user_id)))
      ))
    );
    if (!canAccessEvolution && !canAccessWhatsAppOfficial) {
      return errorResponse('Acesso negado.', 403);
    }

    // 2. Montar lista de conversation_ids (inclui irmãs da mesma linha quando solicitado)
    let conversationIds: string[] = [conversation_id!];
    if (include_siblings && !before_timestamp && conversation.instance_id && conversation.user_id) {
      // Busca conversas com o mesmo remote_jid (mesmo telefone) do mesmo usuário
      const { data: conv } = await supabaseServiceRole
        .from('chat_conversations')
        .select('remote_jid')
        .eq('id', conversation_id)
        .single();
      if (conv?.remote_jid) {
        const { data: siblings } = await supabaseServiceRole
          .from('chat_conversations')
          .select('id')
          .eq('user_id', conversation.user_id)
          .eq('remote_jid', conv.remote_jid)
          .eq('is_group', false)
          .neq('id', conversation_id);
        if (siblings && siblings.length > 0) {
          conversationIds = [conversation_id!, ...siblings.map((s) => s.id)];
        }
      }
    }

    // 3. Buscar mensagens com cursor-based pagination
    //    - Sempre ordena DESC para pegar as mais recentes (ou as anteriores ao cursor)
    //    - Depois reverte para exibição cronológica (mais antiga primeiro)
    let query = supabaseServiceRole
      .from('chat_messages')
      .select('*')
      .in('conversation_id', conversationIds)
      .order('timestamp', { ascending: false })
      .limit(conversationIds.length > 1 ? Math.min(limit * 2, 200) : limit);

    if (before_timestamp) {
      query = query.lt('timestamp', parseInt(before_timestamp, 10));
    }

    const { data: messages, error } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar mensagens: ${error.message}`);
    }

    const result = (messages || []).reverse(); // ordem cronológica para exibição
    const hasMore = conversationIds.length === 1 && (messages || []).length === limit;

    // 3. Zerar contador de não lidas ao abrir a conversa (apenas na carga inicial, sem cursor)
    if (!before_timestamp) {
      await supabaseServiceRole
        .from('chat_conversations')
        .update({ unread_count: 0 })
        .eq('id', conversation_id);
    }

    return successResponse(result, { meta: { has_more: hasMore } });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/chat/messages
 * Apaga uma mensagem do banco e tenta deletar via Evolution API (para canais Evolution).
 * Body: { message_id: string } — o ID interno da linha em chat_messages
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({})) as { message_id?: string };
    const message_id = body.message_id;

    if (!message_id) {
      return errorResponse('message_id é obrigatório', 400);
    }

    // 1. Buscar a mensagem e a conversa associada
    const { data: message, error: msgError } = await supabaseServiceRole
      .from('chat_messages')
      .select('id, conversation_id, message_id, from_me, instance_id, whatsapp_config_id')
      .eq('id', message_id)
      .single();

    if (msgError || !message) {
      return errorResponse('Mensagem não encontrada', 404);
    }

    const { data: conversation, error: convError } = await supabaseServiceRole
      .from('chat_conversations')
      .select('instance_id, whatsapp_config_id, user_id, gerente_id, workspace_id')
      .eq('id', message.conversation_id)
      .single();

    if (convError || !conversation) {
      return errorResponse('Conversa não encontrada', 404);
    }

    // 2. Validar acesso
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdminOrSuporte =
      profile?.status === 'admin' ||
      profile?.status === 'super_admin' ||
      profile?.status === 'suporte';

    if (conversation.instance_id) {
      if (!isAdminOrSuporte) {
        const allowed = await canUserAccessEvolutionChatInstance(userId, profile || {}, conversation.instance_id);
        if (!allowed) return errorResponse('Acesso negado.', 403);
      }
    } else if (conversation.whatsapp_config_id) {
      const sameTenant = conversation.workspace_id === profile?.zaploto_id;
      const allowed = profile?.status === 'super_admin' || (sameTenant && (
          isAdminOrSuporte ||
          (profile?.status === 'captador' && conversation.user_id === userId) ||
          (profile?.status === 'gerente' &&
            (conversation.gerente_id === userId || (!conversation.gerente_id && !conversation.user_id)))
        ));
      if (!allowed) {
        return errorResponse('Acesso negado.', 403);
      }
    } else {
      return errorResponse('Conversa sem canal.', 400);
    }

    // 3. Apagar do banco (realtime notifica o frontend automaticamente)
    const { error: deleteError } = await supabaseServiceRole
      .from('chat_messages')
      .delete()
      .eq('id', message_id);

    if (deleteError) {
      return errorResponse(`Erro ao apagar mensagem: ${deleteError.message}`, 500);
    }

    // 4. Para Evolution: tentar deletar via API (best-effort, não bloqueia)
    if (conversation.instance_id && message.message_id) {
      const { data: instance } = await supabaseServiceRole
        .from('evolution_instances')
        .select('instance_name, apikey, evolution_apis(base_url)')
        .eq('id', conversation.instance_id)
        .single();

      if (instance) {
        const evolutionApi = Array.isArray(instance.evolution_apis)
          ? instance.evolution_apis[0]
          : instance.evolution_apis;
        const baseUrl = (evolutionApi as { base_url?: string } | null)?.base_url;
        const apikey = instance.apikey;
        if (baseUrl && apikey) {
          fetch(`${baseUrl}/message/delete/${instance.instance_name}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', apikey },
            body: JSON.stringify({ id: message.message_id, deleteMessage: true }),
          }).catch(() => {});
        }
      }
    }

    return successResponse({ deleted: true });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
