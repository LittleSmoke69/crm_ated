import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getUserProfile } from '@/lib/middleware/permissions';

interface FlowGraph {
  nodes: Array<{
    id: string;
    type: string;
    data: {
      config?: {
        filters?: {
          event_type?: string;
          action?: string;
        };
      };
    };
  }>;
}

/**
 * Normaliza um groupJid para comparação consistente
 */
function normalizeGroupJid(groupJid: string | null): string {
  if (!groupJid) return '';
  let normalized = String(groupJid).trim();
  if (!normalized.includes('@')) {
    normalized = `${normalized}@g.us`;
  }
  return normalized;
}

/**
 * Verifica se dois groupJids correspondem (com normalização)
 */
function groupJidsMatch(jid1: string | null, jid2: string | null): boolean {
  if (!jid1 || !jid2) return false;
  
  const n1 = normalizeGroupJid(jid1);
  const n2 = normalizeGroupJid(jid2);
  
  // Compara normalizados
  if (n1 === n2) return true;
  
  // Compara sem sufixo
  const base1 = n1.replace('@g.us', '');
  const base2 = n2.replace('@g.us', '');
  if (base1 === base2) return true;
  
  return false;
}

/**
 * GET /api/admin/flows/[flowId]/webhook-events
 * Lista eventos do webhook de prod que podem corresponder ao flow
 * Mostra se cada evento disparou execução ou não
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { flowId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const envFilter = searchParams.get('env') || 'prod'; // prod, test, ou all

    // Verifica se é admin
    const profile = await getUserProfile(userId);
    const isAdmin = profile?.status === 'super_admin';

    // Verifica se o flow pertence ao usuário ou se é admin
    let flowQuery = supabaseServiceRole
      .from('flows')
      .select('id, graph_json')
      .eq('id', flowId);

    if (!isAdmin) {
      flowQuery = flowQuery.eq('user_id', userId);
    }

    const { data: flow, error: flowError } = await flowQuery.single();

    if (flowError || !flow) {
      return errorResponse('Flow não encontrado', 404);
    }

    // Extrai o event_type do trigger do flow
    const graph = flow.graph_json as FlowGraph;
    const triggerNode = graph?.nodes?.find(n => n.type === 'webhookTrigger');
    const eventTypeFilter = triggerNode?.data?.config?.filters?.event_type;

    // Busca flow_instances ativas para este flow PRIMEIRO
    const { data: flowInstances } = await supabaseServiceRole
      .from('flow_instances')
      .select('instance_name, group_jid, is_active, user_id')
      .eq('flow_id', flowId)
      .eq('is_active', true);

    // Se não há flow_instances ativas, ainda assim busca eventos (mas mostrará que não há automação)
    const instanceNames = [...new Set((flowInstances || []).map(fi => fi.instance_name).filter(Boolean))];
    
    // Cria um mapa de instância+grupo para verificar se há automação configurada
    // Usando normalização para comparação mais robusta
    const automationMap: Map<string, { instance_name: string; group_jid: string }[]> = new Map();
    if (flowInstances?.length) {
      for (const fi of flowInstances) {
        const normalizedGroup = normalizeGroupJid(fi.group_jid);
        if (!automationMap.has(fi.instance_name)) {
          automationMap.set(fi.instance_name, []);
        }
        automationMap.get(fi.instance_name)!.push({
          instance_name: fi.instance_name,
          group_jid: normalizedGroup,
        });
      }
    }

    // Busca eventos do webhook
    let eventsQuery = supabaseServiceRole
      .from('evolution_webhook_events')
      .select('id, env, event_type, instance_name, remote_jid, created_at, payload, payload_normalized')
      .order('created_at', { ascending: false })
      .limit(limit);

    // Filtra por ambiente se especificado
    if (envFilter !== 'all') {
      eventsQuery = eventsQuery.eq('env', envFilter);
    }

    // Filtra por event_type se o trigger tiver filtro configurado
    if (eventTypeFilter) {
      eventsQuery = eventsQuery.eq('event_type', eventTypeFilter);
    }

    // Filtra por instâncias que têm automação configurada (se houver)
    if (instanceNames.length > 0) {
      eventsQuery = eventsQuery.in('instance_name', instanceNames);
    }

    const { data: events, error: eventsError } = await eventsQuery;

    if (eventsError) {
      console.error('❌ [WEBHOOK-EVENTS] Erro ao buscar eventos:', eventsError);
      return errorResponse('Erro ao buscar eventos', 500);
    }

    // Busca execuções que usaram esses eventos
    const eventIds = (events || []).map(e => e.id);
    
    let executionMap: Record<string, { id: string; status: string; user_id: string; started_at: string }> = {};
    
    if (eventIds.length > 0) {
      const { data: executions } = await supabaseServiceRole
        .from('flow_executions')
        .select('id, trigger_event_id, status, user_id, started_at')
        .eq('flow_id', flowId)
        .in('trigger_event_id', eventIds);

      if (executions?.length) {
        for (const exec of executions) {
          if (exec.trigger_event_id) {
            executionMap[exec.trigger_event_id] = {
              id: exec.id,
              status: exec.status,
              user_id: exec.user_id,
              started_at: exec.started_at,
            };
          }
        }
      }
    }

    // Enriquece eventos com informação de execução e automação
    const enrichedEvents = (events || []).map(event => {
      const execution = executionMap[event.id];
      
      // Extrai groupJid do payload normalizado ou original
      const np = event.payload_normalized || event.payload;
      const groupJid = 
        np?.data?.id ||
        event.payload?.data?.id ||
        np?.normalized?.groupId ||
        np?.normalized?.group_id ||
        np?.groupId ||
        np?.group_id ||
        event.remote_jid ||
        null;

      // Verifica se há automação configurada para este evento (usando normalização)
      let hasAutomation = false;
      if (event.instance_name && groupJid) {
        const instanceAutomations = automationMap.get(event.instance_name);
        if (instanceAutomations) {
          hasAutomation = instanceAutomations.some(auto => 
            groupJidsMatch(auto.group_jid, groupJid)
          );
        }
      }

      // Determina o motivo de não ter executado
      let notExecutedReason: string | null = null;
      if (!execution) {
        if (!event.instance_name) {
          notExecutedReason = 'Instância não identificada no evento';
        } else if (!groupJid) {
          notExecutedReason = 'Grupo não identificado no evento';
        } else if (!hasAutomation) {
          notExecutedReason = `Nenhuma automação ativa para ${event.instance_name} + ${groupJid?.substring(0, 15)}...`;
        } else {
          notExecutedReason = 'Evento não correspondeu aos filtros do flow (verificar action/event_type)';
        }
      }

      return {
        id: event.id,
        env: event.env,
        event_type: event.event_type,
        instance_name: event.instance_name,
        group_jid: groupJid,
        created_at: event.created_at,
        has_execution: !!execution,
        execution: execution || null,
        has_automation: hasAutomation,
        not_executed_reason: notExecutedReason,
        // Inclui dados extras para debug
        payload_preview: {
          action: np?.action || np?.normalized?.action || np?.data?.action || event.payload?.data?.action,
          participants_count: np?.data?.participants?.length || event.payload?.data?.participants?.length || 0,
        },
      };
    });

    return successResponse({
      events: enrichedEvents,
      flow_instances_count: flowInstances?.length || 0,
      event_type_filter: eventTypeFilter,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
