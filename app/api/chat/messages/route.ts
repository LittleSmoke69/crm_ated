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
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    if (!conversation_id) {
      return errorResponse('conversation_id é obrigatório', 400);
    }

    // 1. Validar acesso à conversa
    const { data: conversation, error: convError } = await supabaseServiceRole
      .from('chat_conversations')
      .select('instance_id, whatsapp_config_id, user_id, workspace_id')
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
    const canAccessWhatsAppOfficial =
      conversation.whatsapp_config_id &&
      (isAdminOrSuporte || conversation.workspace_id === profile?.zaploto_id);
    if (!canAccessEvolution && !canAccessWhatsAppOfficial) {
      return errorResponse('Acesso negado.', 403);
    }

    // 2. Buscar mensagens com cursor-based pagination
    //    - Sempre ordena DESC para pegar as mais recentes (ou as anteriores ao cursor)
    //    - Depois reverte para exibição cronológica (mais antiga primeiro)
    let query = supabaseServiceRole
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversation_id)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (before_timestamp) {
      // Carregar mensagens mais antigas que o cursor
      query = query.lt('timestamp', parseInt(before_timestamp, 10));
    }

    const { data: messages, error } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar mensagens: ${error.message}`);
    }

    const result = (messages || []).reverse(); // ordem cronológica para exibição
    const hasMore = (messages || []).length === limit;

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
