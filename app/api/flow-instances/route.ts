import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';
import { FlowTemplatesService } from '@/lib/services/flow-templates-service';

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
    // Boas-vindas: detecta várias ativações no mesmo (instância, grupo) — ex.: admin + usuário (só uma aparecia no front)
    const welcomeName = FlowTemplatesService.WELCOME_TEMPLATE_NAME;
    const welcomeType = FlowTemplatesService.WELCOME_TEMPLATE_TYPE;

    const { data: welcomeFlows } = await supabaseServiceRole
      .from('flows')
      .select('id')
      .eq('name', welcomeName)
      .eq('type', welcomeType);

    const welcomeFlowIds = (welcomeFlows || []).map((f) => f.id).filter(Boolean);
    let welcomePeerByPair = new Map<string, { id: string; user_id: string; flow_id: string }[]>();

    if (welcomeFlowIds.length > 0) {
      const { data: allWelcomeInstances } = await supabaseServiceRole
        .from('flow_instances')
        .select('id, user_id, flow_id, instance_name, group_jid')
        .in('flow_id', welcomeFlowIds)
        .eq('is_active', true);

      for (const row of allWelcomeInstances || []) {
        const k = `${row.instance_name}\t${row.group_jid}`;
        if (!welcomePeerByPair.has(k)) welcomePeerByPair.set(k, []);
        welcomePeerByPair.get(k)!.push({
          id: row.id,
          user_id: row.user_id,
          flow_id: row.flow_id,
        });
      }
    }

    const enriched = list.map((i: any) => {
      const k = `${i.instance_name}\t${i.group_jid}`;
      const peers = welcomePeerByPair.get(k) || [];
      const isWelcomeFlow =
        i.flows?.name === welcomeName && i.flows?.type === welcomeType;

      return {
        ...i,
        group_subject: groupSubjectMap[i.group_jid] || null,
        welcome_parallel_active:
          isWelcomeFlow && peers.length > 1 ? peers.length : undefined,
        welcome_peer_user_ids:
          isWelcomeFlow && peers.length > 1
            ? [...new Set(peers.filter((p) => p.user_id !== userId).map((p) => p.user_id))]
            : undefined,
      };
    });

    const duplicateWelcomeGroups: Array<{
      instance_name: string;
      group_jid: string;
      active_count: number;
      activation_ids: string[];
    }> = [];

    for (const [pairKey, peers] of welcomePeerByPair) {
      if (peers.length <= 1) continue;
      const [instance_name, group_jid] = pairKey.split('\t');
      const userTouched = list.some(
        (r: any) => r.instance_name === instance_name && r.group_jid === group_jid,
      );
      if (!userTouched) continue;
      duplicateWelcomeGroups.push({
        instance_name,
        group_jid,
        active_count: peers.length,
        activation_ids: peers.map((p) => p.id),
      });
    }

    return successResponse(enriched, {
      meta: {
        welcome_duplicate_groups: duplicateWelcomeGroups,
      },
    });
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

    // Uma linha por (flow_id, instance_name, group_jid) no banco — evita duplicar boas-vindas
    // quando admin, super_admin e usuário ativam o mesmo flow no mesmo grupo
    const { data: existingGlobal } = await supabaseServiceRole
      .from('flow_instances')
      .select('id, user_id')
      .eq('flow_id', flow_id)
      .eq('instance_name', instance_name)
      .eq('group_jid', group_jid)
      .maybeSingle();

    if (existingGlobal) {
      if (existingGlobal.user_id === userId) {
        return errorResponse('Esta automação já está configurada para este grupo', 400);
      }
      return errorResponse(
        'Este flow já está ativado neste grupo por outro perfil. Remova a ativação duplicada ou use a mesma conta.',
        409,
      );
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
