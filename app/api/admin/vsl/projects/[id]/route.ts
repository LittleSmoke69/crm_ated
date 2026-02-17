import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

/**
 * GET /api/admin/vsl/projects/[id]
 * Retorna projeto (sem capi_access_token).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireVslProjectAccess(req, id);

    const { data, error } = await supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, slug, is_active, redirect_timer_seconds, logo_path, pixel_id, banca_id, meta_graph_base_url, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      return errorResponse('Projeto não encontrado', 404);
    }
    return successResponse(data);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * PATCH /api/admin/vsl/projects/[id]
 * Atualiza projeto. Body: name?, is_active?, redirect_timer_seconds?, logo_path?, pixel_id?, meta_graph_base_url?.
 * capi_access_token só pode ser setado por endpoint dedicado (nunca retornado).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireVslProjectAccess(req, id);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const allowed = ['name', 'is_active', 'redirect_timer_seconds', 'logo_path', 'pixel_id', 'meta_graph_base_url', 'banca_id'];
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (body[k] !== undefined) payload[k] = body[k];
    }

    const { data, error } = await supabaseServiceRole
      .from('vsl_projects')
      .update(payload)
      .eq('id', id)
      .select('id, name, slug, is_active, redirect_timer_seconds, logo_path, pixel_id, banca_id, updated_at')
      .single();

    if (error) {
      console.error('[admin/vsl/projects PATCH]', error.message);
      return errorResponse('Erro ao atualizar projeto', 500);
    }
    return successResponse(data);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
