import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 80;

/**
 * GET /api/admin/hierarchy-network-audit — Lista auditoria da rede (hierarquia). Apenas super_admin.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const rawLimit = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

    let q = supabaseServiceRole
      .from('hierarchy_network_audit')
      .select('id, created_at, actor_id, actor_email, actor_status, action, target_user_id, summary, meta')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (profile.zaploto_id) {
      q = q.or(`zaploto_id.eq.${profile.zaploto_id},zaploto_id.is.null`);
    }

    const { data, error } = await q;

    if (error) {
      console.error('[hierarchy-network-audit GET]', error);
      return serverErrorResponse(new Error(error.message || 'Erro ao listar auditoria'));
    }

    return successResponse({ entries: data ?? [] });
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
