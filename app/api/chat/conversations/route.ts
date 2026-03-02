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
 * Lista conversas de um canal: instance_id (Evolution) ou whatsapp_config_id (WhatsApp Oficial).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const instance_id = searchParams.get('instance_id');
    const whatsapp_config_id = searchParams.get('whatsapp_config_id');

    if (instance_id && whatsapp_config_id) {
      return errorResponse('Informe apenas instance_id ou whatsapp_config_id', 400);
    }
    if (!instance_id && !whatsapp_config_id) {
      return errorResponse('instance_id ou whatsapp_config_id é obrigatório', 400);
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

    if (instance_id) {
      const { data: instance, error: instError } = await supabaseServiceRole
        .from('evolution_instances')
        .select('user_id, workspace_id')
        .eq('id', instance_id)
        .single();

      if (instError || !instance) {
        return errorResponse('Instância não encontrada', 404);
      }

      if (!isAdminOrSuporte && instance.user_id !== userId) {
        return errorResponse('Acesso negado.', 403);
      }

      const { data: conversations, error } = await supabaseServiceRole
        .from('chat_conversations')
        .select('*')
        .eq('instance_id', instance_id)
        .order('last_message_at', { ascending: false });

      if (error) return errorResponse(`Erro ao buscar conversas: ${error.message}`);
      return successResponse(conversations);
    }

    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id')
      .eq('id', whatsapp_config_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      return errorResponse('Configuração WhatsApp Oficial não encontrada', 404);
    }

    if (!isAdminOrSuporte && config.zaploto_id !== profile?.zaploto_id) {
      return errorResponse('Acesso negado.', 403);
    }

    const { data: conversations, error } = await supabaseServiceRole
      .from('chat_conversations')
      .select('*')
      .eq('whatsapp_config_id', whatsapp_config_id)
      .order('last_message_at', { ascending: false });

    if (error) return errorResponse(`Erro ao buscar conversas: ${error.message}`);
    return successResponse(conversations);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

