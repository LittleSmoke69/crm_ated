import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

/**
 * PATCH /api/admin/redirect/settings
 * Atualiza configurações do redirect do projeto. Body: project_id, redirect_timer_seconds?
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      redirect_timer_seconds?: number;
    };
    const { project_id, redirect_timer_seconds } = body;
    if (!project_id) return errorResponse('project_id é obrigatório', 400);
    await requireVslProjectAccess(req, project_id);

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (redirect_timer_seconds !== undefined) {
      const sec = Math.min(300, Math.max(0, Math.round(redirect_timer_seconds)));
      payload.redirect_timer_seconds = sec;
    }

    const { data, error } = await supabaseServiceRole
      .from('vsl_projects')
      .update(payload)
      .eq('id', project_id)
      .select('id, redirect_timer_seconds')
      .single();

    if (error) {
      console.error('[admin/redirect/settings]', error.message);
      return errorResponse('Erro ao atualizar configurações', 500);
    }
    return successResponse(data);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
