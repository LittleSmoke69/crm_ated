import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/zaploto/roles?zaploto_id=xxx - Lista roles de um tenant
 * Por padrão só retorna cargos ativos (is_active=true).
 * Use ?all=1 para incluir aposentados.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const zaplotoId = req.nextUrl.searchParams.get('zaploto_id');
    if (!zaplotoId) return errorResponse('zaploto_id é obrigatório', 400);
    const includeAll = req.nextUrl.searchParams.get('all') === '1';

    let query = supabaseServiceRole
      .from('zaploto_roles')
      .select('*')
      .eq('zaploto_id', zaplotoId)
      .order('sort_order');

    if (!includeAll) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return successResponse(data || []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao listar roles';
    return errorResponse(message, 403);
  }
}
