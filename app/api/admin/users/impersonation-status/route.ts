import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { readImpersonatorFromRequest } from '@/lib/server/session-token';

/**
 * GET /api/admin/users/impersonation-status
 * Indica se a sessão atual é impersonação ativa (cookie assinado no servidor).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const impersonation = await readImpersonatorFromRequest(req);

    if (!impersonation || impersonation.targetUserId !== userId) {
      return successResponse({ impersonating: false });
    }

    return successResponse({
      impersonating: true,
      adminUserId: impersonation.adminUserId,
      targetUserId: impersonation.targetUserId,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
