import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/chat/instances - Cria uma nova instância de Chat na Evolution API
 *
 * DEPRECADO: use POST /api/instances/create (regra: webhook no mesmo request).
 */
export async function POST(req: NextRequest) {
  try {
    return errorResponse('Endpoint depreciado. Use POST /api/instances/create.', 410);

  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * GET /api/admin/chat/instances - Lista instâncias de chat (admin)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado.', 403);
    }

    const { data: instances, error } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis (
          name,
          base_url
        )
      `)
      .eq('is_chat_instance', true)
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao buscar instâncias: ${error.message}`);
    }

    return successResponse(instances);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

