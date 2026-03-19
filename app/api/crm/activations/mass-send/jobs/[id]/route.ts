/**
 * DELETE /api/crm/activations/mass-send/jobs/[id]
 * Exclui uma campanha de disparo em massa (apenas se pertencer ao usuário).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(_req);
    const { id: jobId } = await params;

    if (!jobId) {
      return errorResponse('ID da campanha é obrigatório', 400);
    }

    const { data: job, error: fetchError } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .select('id, user_id')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return errorResponse('Campanha não encontrada', 404);
    }

    if (job.user_id !== userId) {
      return errorResponse('Sem permissão para excluir esta campanha', 403);
    }

    const { error: deleteError } = await supabaseServiceRole
      .from('activation_mass_send_jobs')
      .delete()
      .eq('id', jobId);

    if (deleteError) {
      console.error('[MASS-SEND] Erro ao excluir job:', deleteError);
      return errorResponse('Erro ao excluir campanha. Tente novamente.', 500);
    }

    return successResponse({ deleted: true }, 'Campanha excluída com sucesso');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
