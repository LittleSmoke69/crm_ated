/**
 * GET /api/anti-spam/scan-logs?config_id=...&page=...&limit=...
 * Histórico de jobs em anti_spam_scan_jobs (varredura automática periódica, lotes e scans da aba Grupos).
 * Apenas configs owner_type=user do usuário autenticado.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const configId = searchParams.get('config_id')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));

    if (!configId) {
      return errorResponse('config_id é obrigatório', 400);
    }

    const { data: config, error: cfgErr } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id')
      .eq('id', configId)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (cfgErr || !config) {
      return errorResponse('Configuração não encontrada', 404);
    }

    const fromRow = (page - 1) * limit;

    const { data: rows, error, count } = await supabaseServiceRole
      .from('anti_spam_scan_jobs')
      .select('*', { count: 'exact' })
      .eq('config_id', configId)
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .range(fromRow, fromRow + limit - 1);

    if (error) return errorResponse(error.message, 500);

    const total = count ?? 0;
    return successResponse(rows ?? [], {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
