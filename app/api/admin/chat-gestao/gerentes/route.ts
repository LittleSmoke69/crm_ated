/**
 * GET /api/admin/chat-gestao/gerentes
 * Lista gerentes (profiles) para criar instância de atendimento em nome de um gerente.
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { data, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .eq('status', 'gerente')
      .order('full_name', { ascending: true });

    if (error) {
      return successResponse([]);
    }
    return successResponse(data ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
