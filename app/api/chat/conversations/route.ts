/* 
 * CHAT API - REATIVADA
 * 
 * API para gerenciar conversas do chat.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/chat/conversations
 * Lista conversas de uma instância específica
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const instance_id = searchParams.get('instance_id');

    if (!instance_id) {
      return errorResponse('instance_id é obrigatório', 400);
    }

    // Validação de acesso à instância
    const { data: instance, error: instError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('user_id, workspace_id')
      .eq('id', instance_id)
      .single();

    if (instError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (profile?.status !== 'admin' && instance.user_id !== userId) {
      return errorResponse('Acesso negado.', 403);
    }

    // Buscar conversas
    const { data: conversations, error } = await supabaseServiceRole
      .from('chat_conversations')
      .select('*')
      .eq('instance_id', instance_id)
      .order('last_message_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao buscar conversas: ${error.message}`);
    }

    return successResponse(conversations);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

