/**
 * GET /api/admin/anti-spam/stats?config_id=...&banca_id=...
 * Retorna métricas básicas: removidos hoje, falhas hoje, top grupos.
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
    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();

    const today = new Date().toISOString().slice(0, 10);

    let actionsQuery = supabaseServiceRole
      .from('anti_spam_actions')
      .select('id, action, result, group_jid, created_at')
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (configId) actionsQuery = actionsQuery.eq('config_id', configId);
    if (bancaId) actionsQuery = actionsQuery.eq('banca_id', bancaId);

    const { data: actions, error } = await actionsQuery;
    if (error) return errorResponse(error.message, 500);

    const list = actions ?? [];
    const removedToday = list.filter((a: any) => a.action === 'remove_from_group' && a.result === 'success').length;
    const failedToday = list.filter((a: any) => a.result === 'fail').length;
    const addedToBlacklistToday = list.filter((a: any) => a.action === 'add_to_blacklist' && a.result === 'success').length;

    const groupCounts: Record<string, number> = {};
    list.forEach((a: any) => {
      const g = a.group_jid || '_';
      groupCounts[g] = (groupCounts[g] || 0) + 1;
    });
    const topGroups = Object.entries(groupCounts)
      .filter(([k]) => k !== '_')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([group_jid, count]) => ({ group_jid, count }));

    return successResponse({
      removed_today: removedToday,
      failed_today: failedToday,
      added_to_blacklist_today: addedToBlacklistToday,
      top_groups: topGroups,
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
