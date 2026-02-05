import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { evolutionBalancer } from '@/lib/services/evolution-balancer';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/**
 * GET /api/admin/evolution/instances
 * Retorna lista de todas as instâncias Evolution com status e métricas
 */
export async function GET(req: NextRequest) {
  try {
    // Autentica e verifica se é admin
    const auth = await requireAuth(req);
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', auth.userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    // Busca todas as instâncias com informações da API Evolution
    const {data: instances, error: instancesError} = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          name,
          base_url,
          is_active,
          is_blocked_for_instances
        )
      `)
      .order('created_at', { ascending: false });

    if (instancesError) {
      return errorResponse(`Erro ao buscar instâncias: ${instancesError.message}`);
    }


    // Formata resposta
    // const formatted = instances.map((inst) => ({
    //   id: inst.id,
    //   evolution_api: inst.evolution_api
    //     ? {
    //         id: inst.evolution_api.id,
    //         name: inst.evolution_api.name,
    //         base_url: inst.evolution_api.base_url,
    //         is_active: inst.evolution_api.is_active,
    //       }
    //     : null,
    //   instance_name: inst.instance_name,
    //   phone_number: inst.phone_number,
    //   status: inst.status,
    //   is_active: inst.is_active,
    //   daily_limit: inst.daily_limit,
    //   sent_today: inst.sent_today,
    //   error_today: inst.error_today,
    //   rate_limit_count_today: inst.rate_limit_count_today,
    //   last_used_at: inst.last_used_at,
    //   cooldown_until: inst.cooldown_until,
    //   in_cooldown: inst.cooldown_until ? new Date(inst.cooldown_until) > new Date() : false,
    //   usage_percentage: inst.daily_limit 
    //     ? Math.round((inst.sent_today / inst.daily_limit) * 100) 
    //     : null,
    // }));
    
    return successResponse(instances, 'Instâncias listadas com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

