import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/list-cleaning/[jobId] - Detalhe do job e itens (lista bruta + lista limpa)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId, profile } = await requireStatus(req, ['super_admin', 'admin', 'gerente']);
    const { jobId } = await params;
    if (!jobId) return errorResponse('jobId obrigatório', 400);

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';

    let query = supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('*')
      .eq('id', jobId);

    if (!isAdmin) {
      query = query.eq('user_id', userId);
    }

    const { data: job, error: jobError } = await query.single();

    if (jobError || !job) {
      return errorResponse(jobError?.message || 'Job não encontrado', 404);
    }

    const { data: run } = await supabaseServiceRole
      .from('list_cleaning_verification_runs')
      .select('id, total_numbers, processed_numbers, status, current_slot')
      .eq('job_id', jobId)
      .single();

    const { data: items, error: itemsError } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('id, phone, is_duplicate, whatsapp_status, verified_at, raw_payload')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (itemsError) return errorResponse(itemsError.message);

    const rawList = (items || []).map((i, idx) => ({
      index: idx + 1,
      phone: i.phone,
      status_raw: i.is_duplicate ? 'duplicado' : (i.whatsapp_status ?? 'pendente'),
    }));

    const cleanList = (items || [])
      .filter((i) => !i.is_duplicate)
      .map((i, idx) => ({
        index: idx + 1,
        phone: i.phone,
        whatsapp_status: i.whatsapp_status ?? 'pendente',
        validated_at: i.verified_at ?? null,
      }));

    return successResponse({
      job,
      run: run ? { id: run.id, total_numbers: run.total_numbers, processed_numbers: run.processed_numbers, status: run.status, current_slot: run.current_slot } : null,
      rawList,
      cleanList,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}
