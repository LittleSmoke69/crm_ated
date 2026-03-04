/**
 * GET /api/admin/zaplink/gestores
 * Lista gestores de tráfego para o admin atribuir formulários no Zaplink.
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req);

    const { data: list, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .eq('status', 'gestor')
      .order('full_name', { ascending: true });

    if (error) {
      return successResponse([]);
    }
    return successResponse(list ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
