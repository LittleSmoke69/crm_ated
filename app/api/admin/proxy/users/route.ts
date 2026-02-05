import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/evolution-apis/users - Lista usuários e suas proxys atribuídas
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    // Busca todas as instâncias e seus respectivos proxies em uma única consulta
    const { data: instances, error: instancesError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        proxy_instances:proxy_id (
          *
        )
      `)
      .order('created_at', { ascending: false });

    if (instancesError) {
      return errorResponse(`Erro ao buscar instâncias: ${instancesError.message}`);
    }

    // Formata a resposta para manter a compatibilidade com o que o frontend espera
    const formattedInstances = (instances || []).map(instance => ({
      ...instance,
      proxy_instances: instance.proxy_instances ? [{
        id: instance.id,
        enabled: true,
        proxy_instances: instance.proxy_instances
      }] : []
    }));

    return successResponse(formattedInstances);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

