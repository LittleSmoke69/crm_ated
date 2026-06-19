/**
 * GET /api/consultor/investment-rounds
 * Lista as rodadas de investimento do próprio consultor (somente leitura).
 * Escopo: consultor_id = id do perfil autenticado.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    if (!userId) return errorResponse('Não autenticado', 403);
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 403);

    const { data, error } = await supabaseServiceRole
      .from('meta_investment_rounds')
      .select('*')
      .eq('consultor_id', profile.id)
      .order('data_inicial', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) return errorResponse(error.message, 500);

    return successResponse({ rounds: data ?? [] });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
