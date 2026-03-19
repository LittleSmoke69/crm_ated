/**
 * DELETE /api/admin/chat-tags/[id] — Remove etiqueta (admin/super_admin)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;
    if (!id) return errorResponse('ID da etiqueta é obrigatório.', 400);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';
    if (!isAdmin) return errorResponse('Acesso negado.', 403);

    const { data: tag } = await supabaseServiceRole
      .from('chat_conversation_tags')
      .select('zaploto_id')
      .eq('id', id)
      .single();

    if (!tag) return errorResponse('Etiqueta não encontrada.', 404);

    if (profile?.status === 'admin' && profile?.zaploto_id && (tag as { zaploto_id?: string }).zaploto_id !== profile.zaploto_id) {
      const tagZap = (tag as { zaploto_id?: string }).zaploto_id;
      if (tagZap) return errorResponse('Sem permissão para excluir esta etiqueta.', 403);
    }

    const { error } = await supabaseServiceRole
      .from('chat_conversation_tags')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[admin/chat-tags] DELETE', error.message);
      return errorResponse(`Erro ao excluir etiqueta: ${error.message}`, 500);
    }

    return successResponse({ deleted: true });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
