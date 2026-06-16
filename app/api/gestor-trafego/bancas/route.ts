import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { canAccessGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { listGestorTrafegoBancas } from '@/lib/services/gestor-trafego-bancas';

/**
 * GET /api/gestor-trafego/bancas
 * Lista bancas do seletor: admin/super (todas); gestor/gerente (user_bancas + hierarquia).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth?.userId) {
      return errorResponse('Não autenticado', 403);
    }
    const userId = auth.userId.trim();
    let profile = await getUserProfile(userId);
    if (!profile) {
      const { data: profileByUserId } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, created_at, banca_url, banca_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    const hasAccess = profile ? await canAccessGestorTrafego(profile) : false;
    if (!profile || !hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego.', 403);
    }

    const result = await listGestorTrafegoBancas(profile.id, userId, profile.status);
    return successResponse(result);
  } catch (err: any) {
    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
