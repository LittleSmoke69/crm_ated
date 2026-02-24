/**
 * GET /api/anti-spam/blacklist?config_id=...
 * Lista blacklist do usuário (scope user).
 * Qualquer usuário autenticado.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));
    if (!configId) return errorResponse('config_id é obrigatório', 400);

    const { data: config } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id')
      .eq('id', configId)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (!config) return errorResponse('Configuração não encontrada', 404);

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseServiceRole
      .from('anti_spam_blacklist')
      .select('*', { count: 'exact', head: false })
      .eq('config_id', configId)
      .eq('scope', 'user')
      .order('last_seen_at', { ascending: false })
      .range(from, to);

    if (error) return errorResponse(error.message, 500);
    const total = count ?? (data?.length ?? 0);
    return successResponse(data ?? [], {
      pagination: { total, page, limit },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
