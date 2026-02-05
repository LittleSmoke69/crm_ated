import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const isNetworkError = (err: any) =>
  err?.message?.includes('fetch failed') ||
  err?.message?.includes('ECONNREFUSED') ||
  err?.message?.includes('ECONNRESET') ||
  err?.message?.includes('ETIMEDOUT') ||
  err?.message?.includes('ENOTFOUND');

/**
 * POST /api/user/heartbeat - Atualiza o status online e o tempo total logado
 * Chamado periodicamente pelo frontend (ex: a cada 60 segundos)
 * Em caso de falha de rede/Supabase, retorna 200 com online: false para não quebrar o front.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const maxRetries = 2;
    let fetchError: any = null;
    let profile: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await supabaseServiceRole
        .from('profiles')
        .select('total_online_time')
        .eq('id', userId)
        .single();
      fetchError = result.error;
      if (!fetchError) {
        profile = result.data;
        break;
      }
      if (isNetworkError(fetchError) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      break;
    }

    if (fetchError) {
      return successResponse({ online: false, total_seconds: null });
    }

    const currentTotal = profile?.total_online_time || 0;
    const newTotal = currentTotal + 60;

    const { error: updateError } = await supabaseServiceRole
      .from('profiles')
      .update({
        total_online_time: newTotal,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError && isNetworkError(updateError)) {
      return successResponse({ online: false, total_seconds: currentTotal });
    }
    if (updateError) {
      return serverErrorResponse(updateError);
    }

    return successResponse({ online: true, total_seconds: newTotal });
  } catch (err: any) {
    if (err.message === 'Não autenticado') {
      return serverErrorResponse(err);
    }
    return successResponse({ online: false, total_seconds: null });
  }
}

