/**
 * POST /api/admin/webhooks/ligacao/reprocess
 * Reprocessa eventos de ligação pendentes (processed_at null) → leads TAG ligação.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { reprocessPendingLigacaoEvents } from '@/lib/services/ligacao-webhook';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();
    const status = String(profile?.status || '').toLowerCase();
    if (status !== 'admin' && status !== 'super_admin') {
      return errorResponse('Acesso negado.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const limit = typeof body.limit === 'number' ? body.limit : 200;
    const sinceIso = typeof body.since === 'string' ? body.since : undefined;

    const result = await reprocessPendingLigacaoEvents({ limit, sinceIso });
    return successResponse(result);
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
