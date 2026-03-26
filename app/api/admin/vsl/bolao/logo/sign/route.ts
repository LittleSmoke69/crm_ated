import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const BUCKET = 'brand-assets';

/**
 * GET /api/admin/vsl/bolao/logo/sign?project_id=...&path=...
 *
 * Retorna signed_url para assets do bucket privados.
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('project_id') ?? '';
    const path = req.nextUrl.searchParams.get('path') ?? '';

    if (!projectId) return errorResponse('project_id é obrigatório', 400);
    if (!path) return errorResponse('path é obrigatório', 400);

    await requireVslProjectAccess(req, projectId);

    // Segurança: só assina assets pertencentes ao padrão do template.
    const expectedPrefix = `bancas/${projectId}/bolao-landing-logos/`;
    if (!path.startsWith(expectedPrefix)) return errorResponse('path inválido', 400);

    const signedExpiresSeconds = 60 * 60 * 24 * 7; // 7 dias
    const { data: signed } = await supabaseServiceRole.storage
      .from(BUCKET)
      .createSignedUrl(path, signedExpiresSeconds);

    if (!signed?.signedUrl) return errorResponse('Não foi possível assinar a URL', 500);

    return successResponse({ signed_url: signed.signedUrl, signedUrl: signed.signedUrl });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

