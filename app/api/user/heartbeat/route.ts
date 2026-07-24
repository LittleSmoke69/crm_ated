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
 * Body opcional: { context: 'crm' } - quando o usuário está em página do CRM (ex.: crm/kanban, crm/transferido, consultor, gerente).
 * Chamado periodicamente pelo frontend (ex: a cada 60 segundos)
 * Em caso de falha de rede/Supabase, retorna 200 com online: false para não quebrar o front.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    let body: { context?: string } = {};
    try {
      body = await req.json();
    } catch {
      // body vazio ou inválido
    }
    const isCrmContext = body?.context === 'crm';

    const { data, error } = await supabaseServiceRole.rpc('record_user_heartbeat', {
      p_user_id: userId,
      p_is_crm: isCrmContext,
    });

    if (error && isNetworkError(error)) return successResponse({ online: false, total_seconds: null });
    if (error) return serverErrorResponse(error);
    const row = Array.isArray(data) ? data[0] : data;
    return successResponse({
      online: true,
      total_seconds: row?.total_online_time ?? 0,
      total_crm_seconds: row?.total_crm_time ?? 0,
      last_seen_at: row?.last_seen_at ?? null,
    });
  } catch (err: any) {
    if (err.message === 'Não autenticado') {
      return serverErrorResponse(err);
    }
    return successResponse({ online: false, total_seconds: null });
  }
}
