import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/flows/[flowId]/executions
 * Lista execuções de um flow
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

    // Verifica se o flow pertence ao usuário
    const { data: flow } = await supabaseServiceRole
      .from('flows')
      .select('id')
      .eq('id', flowId)
      .eq('user_id', userId)
      .single();

    if (!flow) {
      return errorResponse('Flow não encontrado', 404);
    }

    // Lista todas as execuções do flow (prod + test), sem filtrar por user_id
    const { data: executions, error } = await supabaseServiceRole
      .from('flow_executions')
      .select('*')
      .eq('flow_id', flowId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('❌ [FLOWS] Erro ao buscar execuções:', error);
      return errorResponse('Erro ao buscar execuções', 500);
    }

    const list = executions || [];
    const userIds = [...new Set(list.map((e: any) => e.user_id).filter(Boolean))];
    let profileMap: Record<string, { full_name: string | null; email: string }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds);
      if (profiles?.length) {
        for (const p of profiles) {
          profileMap[p.id] = { full_name: p.full_name || null, email: p.email || '' };
        }
      }
    }

    const eventIds = [...new Set(list.map((e: any) => e.trigger_event_id).filter(Boolean))];
    let eventMap: Record<string, { env: string; instance_name: string | null }> = {};
    if (eventIds.length > 0) {
      const { data: events } = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('id, env, instance_name')
        .in('id', eventIds);
      if (events?.length) {
        for (const ev of events) {
          eventMap[ev.id] = { env: ev.env || 'prod', instance_name: ev.instance_name || null };
        }
      }
    }

    const enriched = list.map((e: any) => {
      const fromEvent = e.trigger_event_id ? eventMap[e.trigger_event_id] : null;
      return {
        ...e,
        profile: profileMap[e.user_id] || null,
        env: e.env ?? fromEvent?.env ?? null,
        instance_name: e.instance_name ?? fromEvent?.instance_name ?? null,
      };
    });

    return successResponse(enriched);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

