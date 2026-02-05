import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const MAX_DOWNLOAD = 1000;

/**
 * GET /api/list-cleaning/[jobId]/download?limit=500|1000
 * Retorna CSV com coluna phone (apenas validados - whatsapp_status = active).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId, profile } = await requireStatus(req, ['admin', 'dono_banca', 'gerente']);
    const { jobId } = await params;
    if (!jobId) return errorResponse('jobId obrigatório', 400);

    const isAdmin = profile?.status === 'admin';
    let query = supabaseServiceRole
      .from('list_cleaning_jobs')
      .select('id')
      .eq('id', jobId);
    if (!isAdmin) query = query.eq('user_id', userId);

    const limit = Math.min(
      Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || MAX_DOWNLOAD),
      MAX_DOWNLOAD
    );

    const { data: job, error: jobError } = await query.single();

    if (jobError || !job) return errorResponse('Job não encontrado', 404);

    const { data: items, error: itemsError } = await supabaseServiceRole
      .from('list_cleaning_items')
      .select('phone')
      .eq('job_id', jobId)
      .eq('is_duplicate', false)
      .eq('whatsapp_status', 'active')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (itemsError) return errorResponse(itemsError.message);
    const phones = (items || []).map((r) => r.phone);
    const csv = 'phone\n' + phones.join('\n');

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lista-limpa-${jobId.slice(0, 8)}.csv"`,
      },
    });
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}
