import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/**
 * GET /api/crm/activations/schedules - Lista agendamentos de mensagens.
 * - super_admin e admin: todos os agendamentos (pontual e recorrente).
 * - Usuário normal: apenas os próprios agendamentos (pontual e recorrente).
 * Não filtra por schedule_type: retorna tanto 'once' (pontual) quanto 'recurring'.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    const canSeeAll = profile?.status === 'super_admin' || profile?.status === 'admin';

    let query = supabaseServiceRole
      .from('message_schedules')
      .select(`
        *,
        messages (
          id,
          title,
          content,
          message_type,
          attachment_url
        )
      `)
      .order('created_at', { ascending: false });

    if (!canSeeAll) {
      query = query.eq('user_id', userId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: schedules, error } = await query;

    if (error) {
      console.error('Erro ao buscar agendamentos:', error);
      return errorResponse(`Erro ao buscar agendamentos: ${error.message}`, 500);
    }

    return successResponse(schedules || [], 'Agendamentos carregados com sucesso');
  } catch (err: any) {
    console.error(`❌ [SCHEDULES] Erro geral:`, err);
    return serverErrorResponse(err);
  }
}

