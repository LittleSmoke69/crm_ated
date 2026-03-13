/* 
 * CHAT API - REATIVADA
 * 
 * API para gerenciar conversas do chat.
 * GET: lista conversas. PATCH: atualiza uma conversa (resolver, atribuir, etiquetas).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/chat/conversations
 * Lista conversas de um canal: instance_id (Evolution) ou whatsapp_config_id (WhatsApp Oficial).
 * Retorna todos os campos, incluindo attendance_status, resolved_at, assigned_at, tags.
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
        console.log('[Zaploto Chat] conversations GET — instance_id:', instance_id, '| instância não encontrada');
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

      if (error) {
        console.error('[Zaploto Chat] conversations GET — instance_id:', instance_id, '| erro:', error.message);
        return errorResponse(`Erro ao buscar conversas: ${error.message}`);
      }
      const list = conversations ?? [];
      console.log(
        '[Zaploto Chat] conversations GET — canal=evolution',
        'instance_id:', instance_id,
        '| total:', list.length,
        list.length > 0 ? `| ids: ${list.slice(0, 5).map((c: { id?: string }) => c.id).join(', ')}${list.length > 5 ? '...' : ''}` : ''
      );
      return successResponse(list);
    }

    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id, phone_number_id')
      .eq('id', whatsapp_config_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      console.log('[Zaploto Chat] conversations GET — whatsapp_config_id:', whatsapp_config_id, '| config não encontrada ou inativa');
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

    if (error) {
      console.error('[Zaploto Chat] conversations GET — whatsapp_config_id:', whatsapp_config_id, '| erro:', error.message);
      return errorResponse(`Erro ao buscar conversas: ${error.message}`);
    }
    const list = conversations ?? [];
    const preview = list.slice(0, 5).map((c: { id?: string; remote_jid?: string; title?: string }) => `${c.title ?? c.remote_jid ?? c.id}`);
    console.log(
      '[Zaploto Chat] conversations GET — canal=whatsapp_official',
      'whatsapp_config_id:', whatsapp_config_id,
      'phone_number_id:', (config as { phone_number_id?: string }).phone_number_id,
      '| total:', list.length,
      list.length > 0 ? `| preview: ${preview.join('; ')}${list.length > 5 ? '...' : ''}` : ''
    );
    return successResponse(list);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * PATCH /api/chat/conversations
 * Atualiza uma conversa: marcar como resolvida, atribuir a um usuário, atualizar etiquetas.
 * Body: { conversation_id: string, attendance_status?: 'pendente'|'resolvido', user_id?: string, tags?: string[] }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({})) as {
      conversation_id?: string;
      attendance_status?: 'pendente' | 'resolvido';
      user_id?: string | null;
      tags?: string[];
    };
    const conversationId = body.conversation_id;
    if (!conversationId) {
      return errorResponse('conversation_id é obrigatório', 400);
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

    const { data: conv, error: fetchError } = await supabaseServiceRole
      .from('chat_conversations')
      .select('id, instance_id, whatsapp_config_id, user_id, assigned_at')
      .eq('id', conversationId)
      .single();

    if (fetchError || !conv) {
      return errorResponse('Conversa não encontrada', 404);
    }

    if (conv.instance_id) {
      const { data: instance } = await supabaseServiceRole
        .from('evolution_instances')
        .select('user_id')
        .eq('id', conv.instance_id)
        .single();
      if (!isAdminOrSuporte && instance?.user_id !== userId) {
        return errorResponse('Acesso negado a esta conversa.', 403);
      }
    } else if (conv.whatsapp_config_id) {
      if (!isAdminOrSuporte) {
        return errorResponse('Acesso negado a esta conversa.', 403);
      }
      const { data: config } = await supabaseServiceRole
        .from('whatsapp_official_configs')
        .select('zaploto_id')
        .eq('id', conv.whatsapp_config_id)
        .single();
      const configZap = (config as { zaploto_id?: string } | null)?.zaploto_id ?? null;
      const profileZap = profile?.zaploto_id ?? null;
      const sameTenant = configZap === profileZap;
      const isSuperAdmin = profile?.status === 'super_admin';
      const adminNoTenant = (profile?.status === 'admin' || profile?.status === 'suporte') && !profileZap;
      if (!isSuperAdmin && !sameTenant && !adminNoTenant) {
        return errorResponse('Acesso negado a esta conversa.', 403);
      }
    } else {
      return errorResponse('Conversa sem canal.', 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.attendance_status !== undefined) {
      updates.attendance_status = body.attendance_status;
      if (body.attendance_status === 'resolvido') {
        updates.resolved_at = new Date().toISOString();
      }
    }
    if (body.user_id !== undefined) {
      updates.user_id = body.user_id || null;
      if (body.user_id && !(conv as { assigned_at?: string }).assigned_at) {
        updates.assigned_at = new Date().toISOString();
      }
      if (!body.user_id) {
        updates.assigned_at = null;
      }
    }
    if (body.tags !== undefined) {
      updates.tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string' && t.trim()) : [];
    }

    if (Object.keys(updates).length === 0) {
      return successResponse(conv);
    }

    const { data: updated, error: updateError } = await supabaseServiceRole
      .from('chat_conversations')
      .update(updates)
      .eq('id', conversationId)
      .select()
      .single();

    if (updateError) {
      console.error('[Zaploto Chat] conversations PATCH — erro:', updateError.message);
      return errorResponse(`Erro ao atualizar conversa: ${updateError.message}`, 500);
    }
    return successResponse(updated);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

