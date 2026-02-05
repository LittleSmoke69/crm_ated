import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, isAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';

/**
 * POST /api/campaigns/[campaignId]/check-instances - Verifica status de conexão das instâncias de uma campanha
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { campaignId } = await params;

    // Busca campanha
    const { data: campaign, error: campaignError } = await supabaseServiceRole
      .from('campaigns')
      .select('id, user_id, instances')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return errorResponse('Campanha não encontrada', 404);
    }

    // Verifica permissão
    const isUserAdmin = await isAdmin(userId);
    if (!isUserAdmin && campaign.user_id !== userId) {
      const canAccess = await canAccessUser(userId, campaign.user_id);
      if (!canAccess) {
        return errorResponse('Acesso negado. Você não tem permissão para acessar esta campanha.', 403);
      }
    }

    if (!campaign.instances || !Array.isArray(campaign.instances) || campaign.instances.length === 0) {
      return errorResponse('Campanha não possui instâncias configuradas', 400);
    }

    // Verifica status de cada instância
    const instanceChecks = await Promise.all(
      campaign.instances.map(async (instanceName: string) => {
        try {
          // Busca instância no banco
          const { data: instance, error: instanceError } = await supabaseServiceRole
            .from('evolution_instances')
            .select(`
              *,
              evolution_apis!inner (
                id,
                name,
                base_url,
                api_key_global,
                is_active
              )
            `)
            .eq('instance_name', instanceName)
            .eq('is_active', true)
            .single();

          if (instanceError || !instance) {
            return {
              instance_name: instanceName,
              exists: false,
              connected: false,
              has_proxy: false,
              status: 'not_found',
              error: 'Instância não encontrada',
            };
          }

          const evolutionApi = Array.isArray(instance.evolution_apis) 
            ? instance.evolution_apis[0] 
            : instance.evolution_apis;

          if (!evolutionApi?.api_key_global) {
            return {
              instance_name: instanceName,
              exists: true,
              connected: false,
              has_proxy: !!instance.proxy_id,
              status: instance.status || 'unknown',
              error: 'Instância sem API key configurada',
            };
          }

          // Verifica conexão na Evolution API
          const evolutionData = await evolutionService.getConnectionState(
            instanceName,
            evolutionApi.api_key_global,
            evolutionApi.base_url
          );
          const state = evolutionService.extractState(evolutionData);

          const isConnected = state === 'connected' || state === 'connecting';

          // Atualiza status no banco se necessário
          if (isConnected && instance.status !== 'ok') {
            await supabaseServiceRole
              .from('evolution_instances')
              .update({
                status: 'ok',
                updated_at: new Date().toISOString(),
              })
              .eq('id', instance.id);
          } else if (!isConnected && instance.status === 'ok') {
            await supabaseServiceRole
              .from('evolution_instances')
              .update({
                status: 'disconnected',
                updated_at: new Date().toISOString(),
              })
              .eq('id', instance.id);
          }

          return {
            instance_name: instanceName,
            exists: true,
            connected: isConnected,
            has_proxy: !!instance.proxy_id,
            status: isConnected ? 'ok' : 'disconnected',
            evolution_state: state,
          };
        } catch (error: any) {
          return {
            instance_name: instanceName,
            exists: false,
            connected: false,
            has_proxy: false,
            status: 'error',
            error: error.message || 'Erro ao verificar instância',
          };
        }
      })
    );

    const allConnected = instanceChecks.every(check => check.connected);
    const connectedCount = instanceChecks.filter(check => check.connected).length;

    return successResponse({
      campaign_id: campaignId,
      total_instances: campaign.instances.length,
      connected_count: connectedCount,
      all_connected: allConnected,
      instances: instanceChecks,
    }, 'Verificação concluída');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

