/**
 * GET /api/gerente/zaplink-notifications/bulk-send-log
 * Lista os últimos disparos em massa do gerente (Zaplink) para exibir no modal
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 10));

    const { data: logs, error } = await supabaseServiceRole
      .from('zaplink_bulk_send_log')
      .select('id, sent_count, message_preview, delay_seconds, created_at')
      .eq('gerente_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return successResponse([]);
    return successResponse(logs ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
