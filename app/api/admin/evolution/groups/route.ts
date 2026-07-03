import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionBalancer } from '@/lib/services/evolution-balancer';
import { isEvolutionStackEnabled } from '@/lib/app-scope';

export const runtime = 'nodejs';

/**
 * GET /api/admin/evolution/groups
 * Retorna grupos salvos no banco de dados e grupos da API Evolution
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

    if (!isEvolutionStackEnabled()) {
      return successResponse(
        { dbGroups: [], evolutionGroups: [], totalDbGroups: 0, totalEvolutionGroups: 0 },
        'Stack Evolution desabilitado neste ambiente'
      );
    }

    // Busca grupos salvos no banco
    const { data: dbGroups, error: dbGroupsError } = await supabaseServiceRole
      .from('whatsapp_groups')
      .select('id, group_id, group_subject, instance_name, size, created_at')
      .order('created_at', { ascending: false });

    if (dbGroupsError) {
      console.error('Erro ao buscar grupos do banco:', dbGroupsError);
    }

    // Busca instâncias ativas para buscar grupos da API
    const instances = await evolutionBalancer.getAllInstances();
    const activeInstances = instances.filter(
      (inst) => inst.is_active && inst.status === 'ok' && inst.evolution_api
    );

    // Tenta buscar grupos da primeira instância ativa (ou pode buscar de todas)
    let evolutionGroups: any[] = [];
    if (activeInstances.length > 0) {
      const firstInstance = activeInstances[0];
      const apiKey = firstInstance.evolution_api?.api_key_global;
      if (firstInstance.evolution_api && apiKey) {
        try {
          const { evolutionService } = await import('@/lib/services/evolution-service');
          const groups = await evolutionService.fetchAllGroups(
            firstInstance.instance_name,
            apiKey,
            firstInstance.evolution_api.base_url,
            false // Não precisa de participantes para listagem
          );
          evolutionGroups = groups.map((g: any) => ({
            id: g.id,
            subject: g.subject,
            pictureUrl: g.pictureUrl,
            size: g.size,
          }));
        } catch (error: any) {
          console.warn('Erro ao buscar grupos da Evolution API:', error.message);
          // Continua mesmo se falhar
        }
      }
    }

    return successResponse(
      {
        dbGroups: dbGroups || [],
        evolutionGroups: evolutionGroups,
        totalDbGroups: dbGroups?.length || 0,
        totalEvolutionGroups: evolutionGroups.length,
      },
      'Grupos recuperados com sucesso'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

