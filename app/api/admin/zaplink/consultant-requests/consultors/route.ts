/**
 * GET /api/admin/zaplink/consultant-requests/consultors
 * Lista consultores (profiles status=consultor) para o admin selecionar ao atender solicitação.
 * Query: search= (opcional), limit=50, request_id= (opcional)
 * Quando request_id é informado, exclui consultores já enviados nesta solicitação (apenas pendentes).
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const search = req.nextUrl.searchParams.get('search')?.trim() || '';
    const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)));
    const requestId = req.nextUrl.searchParams.get('request_id')?.trim() || null;

    let consultantIdsToExclude: string[] = [];
    if (requestId) {
      const { data: fulfillments } = await supabaseServiceRole
        .from('zaplink_consultant_request_fulfillments')
        .select('consultant_user_id')
        .eq('request_id', requestId);
      consultantIdsToExclude = (fulfillments ?? []).map((r: { consultant_user_id: string }) => r.consultant_user_id);
    }

    const fetchLimit = consultantIdsToExclude.length > 0 ? limit + consultantIdsToExclude.length : limit;
    let query = supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .eq('status', 'captador')
      .order('full_name', { ascending: true })
      .limit(fetchLimit);

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) return successResponse([]);
    let list = data ?? [];
    if (consultantIdsToExclude.length > 0) {
      const excludeSet = new Set(consultantIdsToExclude);
      list = list.filter((row: { id: string }) => !excludeSet.has(row.id)).slice(0, limit);
    }
    return successResponse(list);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
