/**
 * GET /api/anti-spam/actions?config_id=...&page=...&limit=...
 * Lista ações (remoções, blacklist) do usuário.
 * Qualquer usuário autenticado (verifica owner do config).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const configId = searchParams.get('config_id')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

    let query = supabaseServiceRole
      .from('anti_spam_actions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (configId) {
      const { data: config } = await supabaseServiceRole
        .from('anti_spam_configs')
        .select('id')
        .eq('id', configId)
        .eq('owner_type', 'user')
        .eq('owner_id', userId)
        .single();
      if (config) query = query.eq('config_id', configId);
    }

    const fromRow = (page - 1) * limit;
    query = query.range(fromRow, fromRow + limit - 1);

    const { data, error, count } = await query;
    if (error) return errorResponse(error.message, 500);

    const total = count ?? 0;
    return successResponse(data ?? [], {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
