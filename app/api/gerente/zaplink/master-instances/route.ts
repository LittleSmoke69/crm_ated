/**
 * GET /api/gerente/zaplink/master-instances
 * Lista instâncias mestres do gerente (conectadas) para seleção no disparo em massa.
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    const { data: instances, error } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        id,
        instance_name,
        status
      `)
      .eq('user_id', userId)
      .eq('is_master', true)
      .eq('is_active', true)
      .in('status', ['ok', 'open', 'connected'])
      .order('instance_name');

    if (error) {
      return successResponse([]);
    }

    const list = (instances ?? []).map((i: { id: string; instance_name: string; status: string }) => ({
      id: i.id,
      instance_name: i.instance_name,
      status: i.status,
    }));

    return successResponse(list);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
