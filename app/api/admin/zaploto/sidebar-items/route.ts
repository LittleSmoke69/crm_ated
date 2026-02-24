import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/zaploto/sidebar-items?zaploto_id=xxx - Lista módulos (itens da sidebar) do tenant
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const zaplotoId = req.nextUrl.searchParams.get('zaploto_id');
    if (!zaplotoId) return errorResponse('zaploto_id é obrigatório', 400);

    const { data, error } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .select('*')
      .eq('zaploto_id', zaplotoId)
      .order('sort_order');

    if (error) throw new Error(error.message);
    return successResponse(data || []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao listar módulos';
    return errorResponse(message, 403);
  }
}
