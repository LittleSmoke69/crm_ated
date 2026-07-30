/* 
 * CHAT API - REATIVADA
 * 
 * API para gerenciar instâncias de chat.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/chat/instances
 * Lista instâncias WhatsApp marcadas para chat
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const status = String(profile?.status || '').toLowerCase();
    const isAdmin = status === 'admin' || status === 'super_admin' || status === 'suporte';
    const zaplotoId = (profile as { zaploto_id?: string | null } | null)?.zaploto_id ?? null;

    let query = supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, status, workspace_id, user_id, created_at, is_chat_instance, phone_number')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (isAdmin) {
      // Admin do tenant vê instâncias de qualquer admin do mesmo zaploto (+ órfãs).
      if (status === 'admin') {
        query = zaplotoId
          ? query.or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
          : query.is('zaploto_id', null);
      }
    } else {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) return errorResponse(`Erro ao buscar instâncias de chat: ${error.message}`, 500);

    return successResponse(data || []);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}


