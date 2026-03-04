/**
 * DELETE /api/gestor-trafego/zaplink/submissions/[id]
 * Remove submissão pendente apenas se pertencer a formulário do gestor.
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireStatus(_req, ['gestor']);
    const { id: submissionId } = await params;

    const { data: submission, error: fetchError } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select('id, status, zaplink_form_id')
      .eq('id', submissionId)
      .single();

    if (fetchError || !submission) {
      return errorResponse('Submissão não encontrada', 404);
    }

    const { data: form } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id')
      .eq('id', submission.zaplink_form_id)
      .eq('gestor_trafego_user_id', userId)
      .single();

    if (!form) {
      return errorResponse('Submissão não pertence aos seus formulários', 403);
    }

    if (submission.status !== 'pending') {
      return errorResponse('Só é possível apagar leads pendentes.', 400);
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
