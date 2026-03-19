/**
 * GET /api/chat/tags
 * Lista etiquetas disponíveis para marcar conversas (para o suporte usar no chat).
 * Retorna tags do tenant do usuário + tags globais (zaploto_id null).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('zaploto_id')
      .eq('id', userId)
      .single();

    let query = supabaseServiceRole
      .from('chat_conversation_tags')
      .select('id, name, color, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (profile?.zaploto_id) {
      query = query.or(`zaploto_id.eq.${profile.zaploto_id},zaploto_id.is.null`);
    } else {
      query = query.is('zaploto_id', null);
    }

    const { data: tags, error } = await query;

    if (error) {
      console.error('[chat/tags] GET', error.message);
      return errorResponse(`Erro ao listar etiquetas: ${error.message}`, 500);
    }

    return successResponse(tags || []);
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
