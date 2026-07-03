import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  appendRestoreAdminSession,
  readImpersonatorFromRequest,
} from '@/lib/server/session-token';

/**
 * POST /api/admin/users/restore-admin-session
 * Restaura a sessão do admin após impersonação de outro usuário.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: currentUserId } = await requireAuth(req);
    const impersonation = await readImpersonatorFromRequest(req);

    if (!impersonation) {
      return errorResponse('Nenhuma sessão de impersonação ativa.', 400);
    }

    if (impersonation.targetUserId !== currentUserId) {
      return errorResponse('Sessão de impersonação inválida.', 403);
    }

    const { adminUserId } = impersonation;

    const { data: adminProfile } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, status')
      .eq('id', adminUserId)
      .single();

    const canRestore =
      adminProfile &&
      (adminProfile.status === 'super_admin' ||
        adminProfile.status === 'admin' ||
        adminProfile.status === 'dono_banca');

    if (!canRestore) {
      return errorResponse('Admin original não encontrado ou sem permissão.', 403);
    }

    const res = successResponse({
      adminUserId: adminProfile.id,
      adminEmail: adminProfile.email,
      adminStatus: adminProfile.status,
    });
    await appendRestoreAdminSession(res, adminProfile.id);
    return res;
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
