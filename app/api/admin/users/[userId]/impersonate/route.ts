import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/users/[userId]/impersonate - Permite ao admin fazer login como outro usuário
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: adminUserId } = await requireAuth(req);
    const { userId: targetUserId } = await params;

    // 1. Verifica se o requester é admin
    const { data: adminProfile } = await supabaseServiceRole
      .from('profiles')
      .select('status, email')
      .eq('id', adminUserId)
      .single();

    const canImpersonate = adminProfile && (adminProfile.status === 'super_admin' || adminProfile.status === 'admin' || adminProfile.status === 'dono_banca');
    if (!canImpersonate) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar contas de outros usuários.', 403);
    }

    // 2. Verifica se o usuário alvo existe
    const { data: targetProfile, error: targetError } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status')
      .eq('id', targetUserId)
      .single();

    if (targetError || !targetProfile) {
      return errorResponse('Usuário não encontrado', 404);
    }

    // 3. Não permite impersonar outro admin ou super_admin (por segurança)
    if ((targetProfile.status === 'admin' || targetProfile.status === 'super_admin') && adminUserId !== targetUserId) {
      return errorResponse('Não é possível acessar a conta de outro administrador por segurança.', 403);
    }

    // 4. Retorna os dados do usuário alvo para que o frontend possa fazer o login
    return successResponse({
      targetUserId: targetProfile.id,
      targetEmail: targetProfile.email,
      targetName: targetProfile.full_name,
      adminUserId: adminUserId,
      adminEmail: adminProfile.email,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

