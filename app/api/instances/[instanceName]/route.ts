import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';
import { getUserEvolutionApi } from '@/lib/services/evolution-api-helper';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

/**
 * GET /api/instances/[instanceName] - Busca uma instância específica
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;

    const hasAccess = await checkInstanceAccess(req, userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar esta instância.', 403);
    }

    // Busca a instância
    const { data, error } = await supabaseServiceRole
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
      .eq('evolution_apis.is_active', true)
      .single();

    if (error || !data) {
      return errorResponse('Instância não encontrada', 404);
    }

    // Converte para formato compatível
    const formatted = {
      id: data.id,
      instance_name: data.instance_name,
      status: data.status === 'ok' ? 'connected' : 'disconnected',
      number: data.phone_number,
      created_at: data.created_at,
      updated_at: data.updated_at,
      hash: Array.isArray(data.evolution_apis) ? data.evolution_apis[0]?.api_key_global : data.evolution_apis?.api_key_global || null,
      qr_code: null,
      user_id: userId,
      blocked_from_maturation: data.blocked_from_maturation === true,
    };

    return successResponse(formatted);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar instância', 401);
  }
}

/**
 * PATCH /api/instances/[instanceName] - Atualiza uma instância específica
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;

    const hasAccess = await checkInstanceAccess(req, userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para alterar esta instância.', 403);
    }

    const body = await req.json();
    const { phone_number, blocked_from_maturation } = body;
    const hasPhone = 'phone_number' in body;
    const hasBlock = 'blocked_from_maturation' in body;

    if (!hasPhone && !hasBlock) {
      return errorResponse('Informe phone_number e/ou blocked_from_maturation', 400);
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (hasPhone) patch.phone_number = phone_number;
    if (hasBlock) patch.blocked_from_maturation = Boolean(blocked_from_maturation);

    const { data, error } = await supabaseServiceRole
      .from('evolution_instances')
      .update(patch)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar instância: ${error.message}`);
    }

    return successResponse(data, 'Instância atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/instances/[instanceName] - Deleta uma instância
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;

    const { data: instances, error: fetchError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis (
          id,
          base_url,
          api_key_global,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .limit(1);

    // Se não encontrou no banco, tenta deletar na Evolution API mesmo assim (pode existir só lá)
    if (fetchError || !instances || instances.length === 0) {
      // Busca todas as Evolution APIs ativas para tentar deletar
      const { data: evolutionApis } = await supabaseServiceRole
        .from('evolution_apis')
        .select('id, base_url, api_key_global, is_active')
        .eq('is_active', true)
        .not('api_key_global', 'is', null);

      if (evolutionApis && evolutionApis.length > 0) {
        let deletedInEvolution = false;
        for (const api of evolutionApis) {
          try {
            const normalizedBaseUrl = api.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
            const deleteUrl = `${normalizedBaseUrl}/instance/delete/${instanceName}`;
            const finalUrl = deleteUrl.replace(/([^:]\/)\/+/g, '$1');
            
            const deleteResponse = await fetch(finalUrl, {
              method: 'DELETE',
              headers: {
                apikey: api.api_key_global,
              },
            });
            
            if (deleteResponse.ok) {
              deletedInEvolution = true;
              break;
            }
          } catch {
            // Continuar tentando outras APIs
          }
        }
        
        if (deletedInEvolution) {
          return successResponse(null, 'Instância deletada na Evolution API (não estava no banco Zaploto)');
        }
      }
      
      return errorResponse('Instância não encontrada no banco de dados', 404);
    }

    const hasAccess = await checkInstanceAccess(req, userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para excluir esta instância.', 403);
    }

    const instance = instances[0];
    console.log(`🔍 [DELETE INSTANCE] Instância encontrada:`, {
      instanceId: instance.id,
      instanceName: instance.instance_name,
      instanceUserId: instance.user_id,
      instanceIsActive: instance.is_active,
      instanceStatus: instance.status,
      requestUserId: userId,
    });

    // Antes de deletar evolution_instances: remove vínculos do maturador (master_instances é CASCADE,
    // mas maturation_jobs referencia master_instances com RESTRICT — então limpamos jobs e desbloqueamos primeiro)
    const { data: masterRows } = await supabaseServiceRole
      .from('master_instances')
      .select('id')
      .eq('evolution_instance_id', instance.id);

    if (masterRows && masterRows.length > 0) {
      for (const master of masterRows) {
        await supabaseServiceRole
          .from('master_instances')
          .update({ is_locked: false, locked_job_id: null, locked_at: null })
          .eq('id', master.id);
        await supabaseServiceRole
          .from('maturation_jobs')
          .delete()
          .eq('master_instance_id', master.id);
      }
    }

    // Remove configs de anti-spam que usam esta instância como master (FK anti_spam_configs_master_instance_id_fkey)
    await supabaseServiceRole
      .from('anti_spam_configs')
      .delete()
      .eq('master_instance_id', instance.id);

    // PRIMEIRO: Deleta no banco do Zaploto (sempre deleta, mesmo se não encontrar na Evolution API depois)
    console.log(`🗑️ [DELETE INSTANCE] Deletando instância ${instanceName} (ID: ${instance.id}) do banco Zaploto...`);
    const { error: deleteError } = await supabaseServiceRole
      .from('evolution_instances')
      .delete()
      .eq('id', instance.id);

    if (deleteError) {
      return errorResponse(`Erro ao deletar: ${deleteError.message}`);
    }

    // DEPOIS: Tenta deletar na Evolution API (se houver API configurada)
    // Se não encontrar na Evolution API, continua normalmente (já deletou no banco)
    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (evolutionApi?.api_key_global && evolutionApi?.base_url) {
      try {
        const normalizedBaseUrl = evolutionApi.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
        const deleteUrl = `${normalizedBaseUrl}/instance/delete/${instanceName}`;
        const finalUrl = deleteUrl.replace(/([^:]\/)\/+/g, '$1');
        
        const deleteResponse = await fetch(finalUrl, {
          method: 'DELETE',
          headers: {
            apikey: evolutionApi.api_key_global,
          },
        });
        void deleteResponse; // Já deletou no banco; falha na Evolution não impede
      } catch {
        // Continua mesmo se falhar na Evolution - já deletou do banco
      }
    }
    return successResponse(null, 'Instância deletada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

