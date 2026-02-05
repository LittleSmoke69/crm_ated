import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/flow-instances
 * Lista instâncias de flows do usuário (com informações do flow)
 * Admin pode ver todas as instâncias de todos os usuários
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const flowId = searchParams.get('flow_id');
    const instanceName = searchParams.get('instance_name');
    const groupJid = searchParams.get('group_jid');
    const allUsers = searchParams.get('all') === 'true'; // Admin pode ver de todos

    // Verifica se é admin
    const profile = await getUserProfile(userId);
    const isAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

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
        ),
        profiles:user_id (
          id,
          full_name,
          email
        )
      `)
      .order('created_at', { ascending: false });

    // Admin pode ver todas as instâncias se passar all=true
    if (!isAdmin || !allUsers) {
      query = query.eq('user_id', userId);
    }

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

    return successResponse(instances || []);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar instâncias de flows', 401);
  }
}

/**
 * POST /api/admin/flow-instances
 * Cria uma nova instância de flow (aplica um flow a um grupo)
 * Admin pode criar automações para qualquer flow
 * Usuário normal só pode criar para seus próprios flows
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { flow_id, instance_name, group_jid, is_active, settings_json, target_user_id } = body;

    // Validação
    if (!flow_id || !instance_name || !group_jid) {
      return errorResponse('flow_id, instance_name e group_jid são obrigatórios', 400);
    }

    // Verifica se é admin
    const profile = await getUserProfile(userId);
    const isAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

    // Admin pode especificar um target_user_id para criar automação para outro usuário
    const ownerUserId = isAdmin && target_user_id ? target_user_id : userId;

    // Verifica se o flow existe
    let flowQuery = supabaseServiceRole
      .from('flows')
      .select('id, user_id')
      .eq('id', flow_id);

    // Usuário normal só pode usar seus próprios flows
    // Admin pode usar qualquer flow
    if (!isAdmin) {
      flowQuery = flowQuery.eq('user_id', userId);
    }

    const { data: flow, error: flowError } = await flowQuery.single();

    if (flowError || !flow) {
      return errorResponse('Flow não encontrado ou sem permissão', 404);
    }

    // Verifica se a instância é mestre
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

    // Verifica se já existe instância para este flow + instância + grupo + usuário
    const { data: existing } = await supabaseServiceRole
      .from('flow_instances')
      .select('id')
      .eq('flow_id', flow_id)
      .eq('instance_name', instance_name)
      .eq('group_jid', group_jid)
      .eq('user_id', ownerUserId)
      .single();

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
        user_id: ownerUserId,
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
        ),
        profiles:user_id (
          id,
          full_name,
          email
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

