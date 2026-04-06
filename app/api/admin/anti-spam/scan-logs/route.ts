/**
 * GET /api/admin/anti-spam/scan-logs
 * Lista logs do scanner de grupos (anti_spam_scan_jobs).
 * Query: page, limit, all_instances (se 1, ignora filter por instancia)
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);

    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));

    const { data: rows, error } = await supabaseServiceRole
      .from('anti_spam_scan_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) return errorResponse(error.message, 500);

    const { count } = await supabaseServiceRole
      .from('anti_spam_scan_jobs')
      .select('*', { count: 'exact', head: true });

    return successResponse(rows ?? [], {
      pagination: {
        total: count ?? 0,
        page,
        limit,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar logs de scanner', 500);
  }
}
