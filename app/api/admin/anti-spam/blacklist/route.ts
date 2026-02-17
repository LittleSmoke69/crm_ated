/**
 * GET /api/admin/anti-spam/blacklist?config_id=...
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
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    if (!configId) {
      return errorResponse('config_id é obrigatório', 400);
    }
    const { data, error } = await supabaseServiceRole
      .from('anti_spam_blacklist')
      .select('*')
      .eq('config_id', configId)
      .order('last_seen_at', { ascending: false });

    if (error) return errorResponse(error.message, 500);
    return successResponse(data ?? []);
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
