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
import { canUserAccessEvolutionChatInstance } from '@/lib/services/atendimento-chat-access';
import { syncEvolutionDirectoryToChatConversations } from '@/lib/server/evolution-chat-directory-sync';

/**
 * GET /api/chat/conversations
 * Lista conversas de um canal: instance_id (Evolution) ou whatsapp_config_id (WhatsApp Oficial).
 * Evolution: query opcional sync_from_evolution=1 chama a API Evolution (findChats + findContacts)
 * e faz upsert em chat_conversations antes de retornar a lista do banco.
 * Retorna todos os campos, incluindo attendance_status, resolved_at, assigned_at, tags.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const instance_id = searchParams.get('instance_id');
    const whatsapp_config_id = searchParams.get('whatsapp_config_id');
    const syncFromEvolution = searchParams.get('sync_from_evolution') === '1';

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
        .select('id')
        .eq('id', instance_id)
        .single();

      if (instError || !instance) {
        return errorResponse('Instância não encontrada', 404);
      }

      if (!isAdminOrSuporte) {
        const allowed = await canUserAccessEvolutionChatInstance(userId, profile || {}, instance_id);
        if (!allowed) {
          return errorResponse('Acesso negado.', 403);
        }
      }

      let evolutionSyncMeta: Record<string, unknown> | undefined;
      if (syncFromEvolution) {
        const { data: fullInstance, error: fullInstError } = await supabaseServiceRole
          .from('evolution_instances')
          .select(
            `
            id,
            instance_name,
            apikey,
            workspace_id,
            user_id,
            evolution_apis ( base_url )
          `
          )
          .eq('id', instance_id)
          .single();

        const evolutionApi = fullInstance
          ? Array.isArray((fullInstance as { evolution_apis?: unknown }).evolution_apis)
            ? (fullInstance as { evolution_apis: { base_url?: string }[] }).evolution_apis[0]
            : ((fullInstance as { evolution_apis?: { base_url?: string } }).evolution_apis ?? null)
          : null;

        const baseUrl = evolutionApi?.base_url;
        const apikey = (fullInstance as { apikey?: string } | null)?.apikey;

        if (!fullInstError && fullInstance && baseUrl && apikey) {
          const syncResult = await syncEvolutionDirectoryToChatConversations({
            instanceId: instance_id,
            instanceName: String((fullInstance as { instance_name: string }).instance_name),
            baseUrl,
            apikey,
            workspaceId: (fullInstance as { workspace_id?: string | null }).workspace_id ?? null,
            instanceOwnerUserId: (fullInstance as { user_id?: string | null }).user_id ?? null,
          });
          evolutionSyncMeta = {
            evolution_directory_sync: syncResult.error
              ? 'error'
              : syncResult.skippedCooldown
                ? 'skipped_cooldown'
                : 'ok',
            evolution_sync_upserted: syncResult.upserted,
            evolution_sync_error: syncResult.error,
            find_chats_http_status: syncResult.findChatsStatus,
            find_contacts_http_status: syncResult.findContactsStatus,
          };
        } else {
          evolutionSyncMeta = {
            evolution_directory_sync: 'skipped_config',
            evolution_sync_error:
              fullInstError?.message ||
              (!baseUrl || !apikey ? 'Instância sem base_url Evolution ou apikey' : 'Instância incompleta'),
          };
        }
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
      return successResponse(list, evolutionSyncMeta ? { meta: evolutionSyncMeta } : undefined);
    }

    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id, phone_number_id')
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

    if (error) {
      console.error('[Zaploto Chat] conversations GET — whatsapp_config_id:', whatsapp_config_id, '| erro:', error.message);
      return errorResponse(`Erro ao buscar conversas: ${error.message}`);
    }
    const list = conversations ?? [];
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
      if (!isAdminOrSuporte) {
        const allowed = await canUserAccessEvolutionChatInstance(userId, profile || {}, conv.instance_id);
        if (!allowed) {
          return errorResponse('Acesso negado a esta conversa.', 403);
        }
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

