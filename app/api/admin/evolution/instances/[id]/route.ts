import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/evolution/instances/[id] - Atualiza uma instância (especialmente is_master)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;

    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    const body = await req.json();
    const { is_master, user_id: assignUserId, maturation_type: maturationType } = body;

    // Busca a instância atual (status e maturation_status para decidir se inicia maturação virgem)
    const { data: instance, error: fetchError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, user_id, is_master, instance_name, maturation_type, status, maturation_status')
      .eq('id', id)
      .single();

    if (fetchError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    // Número de instâncias mestres por usuário é ilimitado (trava removida).

    // Atualiza a instância
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (typeof is_master === 'boolean') {
      updateData.is_master = is_master;
    }

    if (assignUserId !== undefined) {
      if (assignUserId === null || assignUserId === '') {
        updateData.user_id = null;
      } else if (typeof assignUserId === 'string' && assignUserId.trim() !== '') {
        const targetUserId = assignUserId.trim();
        const { data: targetProfile } = await supabaseServiceRole
          .from('profiles')
          .select('id')
          .eq('id', targetUserId)
          .single();
        if (!targetProfile) {
          return errorResponse('Usuário de destino não encontrado', 400);
        }
        updateData.user_id = targetUserId;
      }
    }

    if (maturationType === 'virgem' || maturationType === 'maturado') {
      updateData.maturation_type = maturationType;
      if (maturationType === 'maturado') {
        updateData.maturation_status = null;
        updateData.maturation_started_at = null;
        updateData.maturation_ends_at = null;
        updateData.maturation_phase_started_at = null;
        updateData.maturation_paused_at = null;
        updateData.current_day = null;
        updateData.is_locked = false;
      } else {
        // virgem: se a instância já está conectada e ainda não está em maturação, inicia o processo (5 dias)
        const isConnected = instance.status === 'ok' || instance.status === 'connected';
        if (isConnected && !instance.maturation_status) {
          const now = new Date();
          const endsAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
          updateData.maturation_status = 'waiting_connection_test';
          updateData.maturation_started_at = now.toISOString();
          updateData.maturation_ends_at = endsAt.toISOString();
          updateData.maturation_phase_started_at = now.toISOString();
          updateData.current_day = 1;
          updateData.is_locked = true;
        }
      }
    }

    const { data: updatedInstance, error: updateError } = await supabaseServiceRole
      .from('evolution_instances')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return errorResponse(`Erro ao atualizar instância: ${updateError.message}`);
    }

    return successResponse(updatedInstance, 'Instância atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/evolution/instances/[id] - Deleta uma instância
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;

    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    // Busca a instância
    const { data: instance, error: fetchError } = await supabaseServiceRole
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
      .eq('id', id)
      .single();

    if (fetchError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    console.log(`🗑️ [DELETE INSTANCE] Instância encontrada: ${instance.instance_name}, Status: ${instance.status}`);

    // Remove vínculos do maturador antes de deletar (maturation_jobs -> master_instances -> evolution_instances)
    const { data: masterRows } = await supabaseServiceRole
      .from('master_instances')
      .select('id')
      .eq('evolution_instance_id', id);

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

    // Remove configs de anti-spam que referenciam esta instância
    // (FK: anti_spam_configs.master_instance_id -> evolution_instances.id)
    const { error: antiSpamDeleteError } = await supabaseServiceRole
      .from('anti_spam_configs')
      .delete()
      .eq('master_instance_id', id);

    if (antiSpamDeleteError) {
      console.error(`❌ [DELETE INSTANCE] Erro ao remover vínculos do anti-spam:`, antiSpamDeleteError);
      return errorResponse(`Erro ao remover vínculos do anti-spam: ${antiSpamDeleteError.message}`);
    }

    // Deleta na Evolution API (se houver API configurada)
    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (evolutionApi?.api_key_global && evolutionApi?.base_url) {
      try {
        const normalizedBaseUrl = evolutionApi.base_url.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
        const deleteUrl = `${normalizedBaseUrl}/instance/delete/${instance.instance_name}`;
        const finalUrl = deleteUrl.replace(/([^:]\/)\/+/g, '$1');
        
        console.log(`🗑️ [DELETE INSTANCE] Tentando deletar na Evolution API: ${finalUrl}`);
        
        const deleteResponse = await fetch(finalUrl, {
          method: 'DELETE',
          headers: {
            apikey: evolutionApi.api_key_global,
          },
        });
        
        if (!deleteResponse.ok) {
          const errorText = await deleteResponse.text().catch(() => '');
          console.warn(`⚠️ [DELETE INSTANCE] Não foi possível deletar instância na Evolution API: ${deleteResponse.status} ${errorText}`);
        } else {
          console.log(`✅ [DELETE INSTANCE] Instância deletada na Evolution API com sucesso`);
        }
      } catch (evolutionError: any) {
        console.error(`❌ [DELETE INSTANCE] Erro ao deletar na Evolution:`, evolutionError);
        // Continua mesmo se falhar na Evolution - deleta do banco mesmo assim
      }
    } else {
      console.warn(`⚠️ [DELETE INSTANCE] Evolution API não configurada ou sem api_key_global/base_url. Deletando apenas do banco.`);
    }

    // Deleta no banco
    console.log(`🗑️ [DELETE INSTANCE] Deletando instância ${instance.instance_name} (ID: ${instance.id}) do banco...`);
    const { error: deleteError } = await supabaseServiceRole
      .from('evolution_instances')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error(`❌ [DELETE INSTANCE] Erro ao deletar do banco:`, deleteError);
      return errorResponse(`Erro ao deletar: ${deleteError.message}`);
    }

    console.log(`✅ [DELETE INSTANCE] Instância ${instance.instance_name} deletada com sucesso do banco`);
    return successResponse(null, 'Instância deletada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

