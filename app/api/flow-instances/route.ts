import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

/**
 * GET /api/flow-instances
 * Lista instâncias de flows do usuário (gerente/dono de banca)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const flowId = searchParams.get('flow_id');
    const instanceName = searchParams.get('instance_name');
    const groupJid = searchParams.get('group_jid');

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
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (flowId) {
      query = query.eq('flow_id', flowId);
    }
    if (instanceName) {
      query = query.eq('instance_name', instanceName);
    }
    if (groupJid) {
      query = query.eq('group_jid', groupJid);
    }

    const { data: instances, error } = await query;

    if (error) {
      console.error('❌ [FLOW-INSTANCES] Erro ao buscar instâncias:', error);
      return errorResponse('Erro ao buscar instâncias de flows', 500);
    }

    const list = instances || [];
    const groupJids = [...new Set(list.map((i: any) => i.group_jid).filter(Boolean))];
    let groupSubjectMap: Record<string, string> = {};
    if (groupJids.length > 0) {
      const { data: groups } = await supabaseServiceRole
        .from('whatsapp_groups')
        .select('group_id, group_subject')
        .eq('user_id', userId)
        .in('group_id', groupJids);
      if (groups?.length) {
        for (const g of groups) {
          if (g.group_id && g.group_subject) groupSubjectMap[g.group_id] = g.group_subject;
        }
      }
    }
    const enriched = list.map((i: any) => ({
      ...i,
      group_subject: groupSubjectMap[i.group_jid] || null,
    }));

    return successResponse(enriched);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar instâncias de flows', 401);
  }
}

/**
 * POST /api/flow-instances
 * Cria uma nova instância de flow (gerente/dono de banca)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { flow_id, instance_name, group_jid, is_active, settings_json } = body;

    // Validação
    if (!flow_id || !instance_name || !group_jid) {
      return errorResponse('flow_id, instance_name e group_jid são obrigatórios', 400);
    }

    // Verifica se o flow existe (flows são criados apenas por admin)
    const { data: flow, error: flowError } = await supabaseServiceRole
      .from('flows')
      .select('id, status')
      .eq('id', flow_id)
      .eq('status', 'active') // Só permite configurar flows ativos
      .single();

    if (flowError || !flow) {
      return errorResponse('Flow não encontrado ou inativo', 404);
    }

    // Verifica se o usuário tem acesso à instância
    const hasAccess = await checkInstanceAccess(userId, instance_name);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para usar esta instância.', 403);
    }

    // Verifica se a instância é mestre e está conectada
    const { data: evolutionInstance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, is_master, status')
      .eq('instance_name', instance_name)
      .single();

    if (instanceError || !evolutionInstance) {
      return errorResponse('Instância não encontrada', 404);
    }

    if (!evolutionInstance.is_master) {
      return errorResponse('Apenas instâncias mestre podem ser usadas em automações', 400);
    }

    if (evolutionInstance.status !== 'ok') {
      return errorResponse('A instância deve estar conectada (status: ok) para ser usada em automações', 400);
    }

    // Verifica se já existe instância para este flow + instância + grupo do usuário
    const { data: existing } = await supabaseServiceRole
      .from('flow_instances')
      .select('id')
      .eq('flow_id', flow_id)
      .eq('instance_name', instance_name)
      .eq('group_jid', group_jid)
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      return errorResponse('Esta automação já está configurada para este grupo', 400);
    }

    const { data: instance, error } = await supabaseServiceRole
      .from('flow_instances')
      .insert({
        flow_id,
        instance_name,
        group_jid,
        is_active: is_active !== undefined ? is_active : true,
        settings_json: settings_json || {},
        user_id: userId,
        created_by: userId,
      })
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
      .single();

    if (error) {
      console.error('❌ [FLOW-INSTANCES] Erro ao criar instância:', error);
      return errorResponse('Erro ao criar instância de flow', 500);
    }

    return successResponse(instance, 'Instância de flow criada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
