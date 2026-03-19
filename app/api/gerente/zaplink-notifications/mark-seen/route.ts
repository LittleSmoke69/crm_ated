/**
 * POST /api/gerente/zaplink-notifications/mark-seen
 * Marca notificações como vistas (seen_at = NOW)
 * Body: { notification_ids?: string[] } - se omitido, marca todas do gerente
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    const body = await req.json().catch(() => ({}));
    const notificationIds = Array.isArray(body.notification_ids) ? body.notification_ids : undefined;

    let query = supabaseServiceRole
      .from('zaplink_gerente_notifications')
      .update({ seen_at: new Date().toISOString() })
      .eq('gerente_id', userId)
      .is('seen_at', null);

    if (notificationIds && notificationIds.length > 0) {
      query = query.in('id', notificationIds);
    }

    const { error } = await query;

    if (error) {
      return successResponse({ updated: 0 });
    }

    return successResponse({ updated: true }, 'Notificações marcadas como lidas');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
