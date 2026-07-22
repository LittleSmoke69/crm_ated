/*
 * HISTÓRICO DE RESOLUÇÕES DO CHAT
 *
 * GET: lista o histórico de ciclos "resolvido -> reaberto" de uma conversa ou de um cliente
 * (remote_jid) inteiro, para metrificar reincidência de atendimento.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { canUserAccessEvolutionChatInstance } from '@/lib/services/atendimento-chat-access';

/**
 * GET /api/chat/conversations/resolution-history?conversation_id=...
 * GET /api/chat/conversations/resolution-history?remote_jid=...&instance_id=...
 * GET /api/chat/conversations/resolution-history?remote_jid=...&whatsapp_config_id=...
 * Retorna: { resolutions: [...], total_resolutions, total_reopened }
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get('conversation_id');
    const remoteJid = searchParams.get('remote_jid');
    const instanceId = searchParams.get('instance_id');
    const whatsappConfigId = searchParams.get('whatsapp_config_id');

    if (!conversationId && !remoteJid) {
      return errorResponse('Informe conversation_id ou remote_jid', 400);
    }
    if (remoteJid && !instanceId && !whatsappConfigId) {
      return errorResponse('Ao usar remote_jid, informe também instance_id ou whatsapp_config_id', 400);
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

    let effectiveInstanceId = instanceId;
    let effectiveWhatsappConfigId = whatsappConfigId;

    if (conversationId) {
      const { data: conv, error: convError } = await supabaseServiceRole
        .from('chat_conversations')
        .select('instance_id, whatsapp_config_id')
        .eq('id', conversationId)
        .single();
      if (convError || !conv) {
        return errorResponse('Conversa não encontrada', 404);
      }
      effectiveInstanceId = conv.instance_id;
      effectiveWhatsappConfigId = conv.whatsapp_config_id;
    }

    if (effectiveInstanceId) {
      if (!isAdminOrSuporte) {
        const allowed = await canUserAccessEvolutionChatInstance(userId, profile || {}, effectiveInstanceId);
        if (!allowed) {
          return errorResponse('Acesso negado.', 403);
        }
      }
    } else if (effectiveWhatsappConfigId) {
      if (!isAdminOrSuporte) {
        return errorResponse('Acesso negado.', 403);
      }
      const { data: config } = await supabaseServiceRole
        .from('whatsapp_official_configs')
        .select('zaploto_id')
        .eq('id', effectiveWhatsappConfigId)
        .single();
      const configZap = (config as { zaploto_id?: string } | null)?.zaploto_id ?? null;
      const profileZap = profile?.zaploto_id ?? null;
      const sameTenant = configZap === profileZap;
      const isSuperAdmin = profile?.status === 'super_admin';
      const adminNoTenant = (profile?.status === 'admin' || profile?.status === 'suporte') && !profileZap;
      if (!isSuperAdmin && !sameTenant && !adminNoTenant) {
        return errorResponse('Acesso negado.', 403);
      }
    } else {
      return errorResponse('Conversa sem canal.', 400);
    }

    let query = supabaseServiceRole
      .from('chat_conversation_resolutions')
      .select('id, conversation_id, resolved_at, resolved_by, reopened_at, reopened_by, reopened_reason')
      .order('resolved_at', { ascending: false });

    if (conversationId) {
      query = query.eq('conversation_id', conversationId);
    } else if (remoteJid) {
      query = query.eq('remote_jid', remoteJid);
      if (effectiveInstanceId) query = query.eq('instance_id', effectiveInstanceId);
      if (effectiveWhatsappConfigId) query = query.eq('whatsapp_config_id', effectiveWhatsappConfigId);
    }

    const { data: resolutions, error } = await query;

    if (error) {
      console.error('[Zaploto Chat] resolution-history GET — erro:', error.message);
      return errorResponse(`Erro ao buscar histórico: ${error.message}`);
    }

    const list = resolutions ?? [];
    return successResponse({
      resolutions: list,
      total_resolutions: list.length,
      total_reopened: list.filter((r) => r.reopened_at).length,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
