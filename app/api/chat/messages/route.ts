/* 
 * CHAT API - REATIVADA
 * 
 * API para gerenciar mensagens do chat.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/chat/messages
 * Lista mensagens de uma conversa
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const conversation_id = searchParams.get('conversation_id');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

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

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';
    const canAccessEvolution = conversation.instance_id && (isAdmin || conversation.user_id === userId);
    const canAccessWhatsAppOfficial = conversation.whatsapp_config_id && (isAdmin || conversation.workspace_id === profile?.zaploto_id);
    if (!canAccessEvolution && !canAccessWhatsAppOfficial) {
      return errorResponse('Acesso negado.', 403);
    }

    // 2. Buscar mensagens
    const { data: messages, error } = await supabaseServiceRole
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return errorResponse(`Erro ao buscar mensagens: ${error.message}`);
    }

    // Zerar contador de não lidas ao abrir a conversa
    await supabaseServiceRole
      .from('chat_conversations')
      .update({ unread_count: 0 })
      .eq('id', conversation_id);

    return successResponse(messages.reverse());
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

