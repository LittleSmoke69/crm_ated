import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/zaploto/tenants - Lista todos os tenants (super_admin)
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);

    const { data, error } = await supabaseServiceRole
      .from('zaploto_tenants')
      .select('*')
      .order('name');

    if (error) throw new Error(error.message);
    return successResponse(data || []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao listar tenants';
    return errorResponse(message, 403);
  }
}
