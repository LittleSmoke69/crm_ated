/**
 * GET /api/gestor-trafego/zaplink/bancas
 * Lista bancas para o gestor usar no Zaplink (atribuir leads). Retorna id, name, url.
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireStatus(_req, ['gestor']);

    const { data: list, error } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .order('name', { ascending: true });

    if (error) {
      return successResponse([]);
    }
    return successResponse(list ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
