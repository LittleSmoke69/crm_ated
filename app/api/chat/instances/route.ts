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
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin';

    let query = supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, status, workspace_id, user_id, created_at')
      .eq('is_chat_instance', true)
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) return errorResponse(`Erro ao buscar instâncias de chat: ${error.message}`, 500);

    return successResponse(data || []);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}


