import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/flows
 * Lista todos os flows ativos do sistema (para gerente/dono de banca configurarem)
 * Retorna apenas flows ativos criados pelo admin
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    // Busca flows ativos (status = 'active')
    // Flows são criados apenas por admin, então gerente/dono de banca precisam ver todos os ativos
    let query = supabaseServiceRole
      .from('flows')
      .select('*')
      .eq('status', 'active') // Apenas flows ativos
      .order('created_at', { ascending: false });

    // Se especificar status diferente, permite filtrar
    if (status && status !== 'active') {
      query = supabaseServiceRole
        .from('flows')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false });
    }

    const { data: flows, error } = await query;

    if (error) {
      console.error('❌ [FLOWS] Erro ao buscar flows:', error);
      return errorResponse('Erro ao buscar flows', 500);
    }

    return successResponse(flows || []);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar flows', 401);
  }
}

