/**
 * API Route: /api/maturation/virgin-instances
 *
 * GET: Lista instâncias em maturação virgem (admin)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile, error: profileError } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (profileError) {
      return errorResponse('Serviço temporariamente indisponível. Tente novamente.', 503);
    }
    if (!profile || profile.status !== 'admin') {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    // Retorna todas as instâncias com maturation_type = 'virgem' (em maturação ou aguardando início)
    const { data: list, error } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        id,
        instance_name,
        status,
        maturation_type,
        maturation_status,
        maturation_started_at,
        maturation_ends_at,
        maturation_phase_started_at,
        maturation_paused_at,
        maturation_last_activity_at,
        current_day,
        is_locked,
        evolution_api_id,
        created_at,
        updated_at
      `)
      .eq('maturation_type', 'virgem')
      .order('maturation_started_at', { ascending: false, nullsFirst: false });

    if (error) {
      const isNetwork =
        error?.message?.includes('fetch failed') ||
        error?.message?.includes('ECONNREFUSED') ||
        error?.message?.includes('ECONNRESET') ||
        error?.message?.includes('ETIMEDOUT') ||
        error?.message?.includes('ENOTFOUND');
      return errorResponse(
        isNetwork ? 'Serviço temporariamente indisponível. Tente novamente.' : `Erro ao listar instâncias virgem: ${error.message}`,
        isNetwork ? 503 : 500
      );
    }

    // Resumo para verificação: maturation_type (virgem/maturado) e maturation_status com dados da maturação
    const summary = {
      total: (list || []).length,
      in_maturation: (list || []).filter((i: { maturation_status: string | null }) => i.maturation_status != null).length,
      awaiting_start: (list || []).filter((i: { maturation_status: string | null }) => i.maturation_status == null).length,
    };
    return successResponse({
      instances: list || [],
      maturation_summary: summary,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
