/**
 * GET /api/admin/anti-spam/actions?config_id=...&from=...&to=...&page=...&limit=...
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const { searchParams } = req.nextUrl;
    const configId = searchParams.get('config_id')?.trim();
    const from = searchParams.get('from')?.trim();
    const to = searchParams.get('to')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));

    let query = supabaseServiceRole
      .from('anti_spam_actions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (configId) query = query.eq('config_id', configId);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

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
