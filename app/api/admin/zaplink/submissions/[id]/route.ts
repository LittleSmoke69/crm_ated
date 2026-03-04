/**
 * DELETE /api/admin/zaplink/submissions/[id]
 * Remove submissão apenas se estiver pendente (sem consultor criado).
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(_req);
    const { id: submissionId } = await params;

    const { data: submission, error: fetchError } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select('id, status')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      return errorResponse('Submissão não encontrada', 404);
    }

    if (submission.status !== 'pending') {
      return errorResponse('Só é possível apagar leads pendentes. Leads já atribuídos não podem ser removidos.', 400);
    }

    const { error: deleteError } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .delete()
      .eq('id', submissionId);

    if (deleteError) {
      return errorResponse(`Erro ao apagar: ${deleteError.message}`, 500);
    }

    return successResponse(null, 'Lead pendente removido.');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
