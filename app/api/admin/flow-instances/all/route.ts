import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getUserProfile, getSubordinates } from '@/lib/middleware/permissions';

/**
 * GET /api/admin/flow-instances/all
 * Lista instâncias de flows. Admin: todas. Dono de banca: só da hierarquia (self + gerentes + consultores).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    const canAccess = profile && (profile.status === 'super_admin' || profile.status === 'admin' || profile.status === 'dono_banca');
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores e donos de banca podem acessar.', 403);
    }

    const { searchParams } = new URL(req.url);
    const flowId = searchParams.get('flow_id');

    let query = supabaseServiceRole
      .from('flow_instances')
      .select(`
        *,
        flows:flow_id (
          id,
          name,
          description,
          type,
          status,
          graph_json
        )
      `)
      .order('created_at', { ascending: false });

    if (flowId) {
      query = query.eq('flow_id', flowId);
    }

    if (profile.status === 'dono_banca') {
      const subs = await getSubordinates(userId);
      const ids = [userId, ...subs.map((s) => s.id)];
      query = query.in('user_id', ids);
    }

    const { data: instances, error } = await query;

    if (error) {
      console.error('❌ [FLOW-INSTANCES] Erro ao buscar instâncias:', error);
      return errorResponse('Erro ao buscar instâncias de flows', 500);
    }

    // Busca dados dos usuários manualmente para cada flow-instance
    const instancesWithUsers = await Promise.all(
      (instances || []).map(async (instance: any) => {
        if (!instance.user_id) {
          return { ...instance, profiles: null };
        }

        const { data: userProfile } = await supabaseServiceRole
          .from('profiles')
          .select('id, email, full_name, status')
          .eq('id', instance.user_id)
          .single();

        return {
          ...instance,
          profiles: userProfile || null,
        };
      })
    );

    return successResponse(instancesWithUsers);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar instâncias de flows', 401);
  }
}
