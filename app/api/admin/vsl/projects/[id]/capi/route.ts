import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

/**
 * PATCH /api/admin/vsl/projects/[id]/capi
 * Atualiza apenas capi_access_token (nunca retornado em GET).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireVslProjectAccess(req, id);

    const body = await req.json().catch(() => ({})) as { capi_access_token?: string | null };
    await supabaseServiceRole
      .from('vsl_projects')
      .update({
        capi_access_token: body.capi_access_token ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return successResponse({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
