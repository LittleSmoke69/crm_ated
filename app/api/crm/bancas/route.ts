import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/crm/bancas - Lista todas as bancas (para filtro no Kanban - acesso para todos autenticados)
 */
export async function GET(req: NextRequest) {
  try {
    // Requer apenas autenticação, não precisa ser admin
    await requireAuth(req);

    const { data: bancas, error } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name, url')
      .order('name', { ascending: true });

    if (error) {
      return errorResponse(`Erro ao buscar bancas: ${error.message}`);
    }

    return successResponse(bancas);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

