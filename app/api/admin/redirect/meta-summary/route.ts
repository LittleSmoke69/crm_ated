import { NextRequest } from 'next/server';
import { buildMetaRedirectSummary } from '@/lib/admin/redirect-meta-summary';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/redirect/meta-summary?project_id=uuid|slug
 */
export async function GET(req: NextRequest) {
  try {
    let projectId = req.nextUrl.searchParams.get('project_id')?.trim() ?? '';
    if (!projectId) return errorResponse('project_id é obrigatório', 400);

    const isSlug = !UUID_RE.test(projectId);
    if (isSlug) {
      const { data: proj } = await supabaseServiceRole
        .from('vsl_projects')
        .select('id')
        .eq('slug', projectId.toLowerCase())
        .maybeSingle();
      if (!proj?.id) return errorResponse('Projeto não encontrado', 404);
      projectId = proj.id;
    }

    await requireVslProjectAccess(req, projectId);

    const { data: project } = await supabaseServiceRole
      .from('vsl_projects')
      .select('banca_id')
      .eq('id', projectId)
      .single();
    if (!project) return errorResponse('Projeto não encontrado', 404);

    const summary = await buildMetaRedirectSummary(projectId, project.banca_id ?? null);
    return successResponse(summary);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
