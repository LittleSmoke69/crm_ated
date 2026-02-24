import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/zaploto/roles/create - Cria novo cargo
 */
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();

    const zaplotoId = body.zaploto_id;
    const code = String(body.code || '').trim().toLowerCase().replace(/\s+/g, '_');
    const label = String(body.label || '').trim();
    if (!zaplotoId || !code || !label) {
      return errorResponse('zaploto_id, code e label são obrigatórios', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('zaploto_roles')
      .insert({
        zaploto_id: zaplotoId,
        code,
        label,
        description: body.description?.trim() || null,
        sort_order: Number(body.sort_order) || 0,
        can_have_enroller: body.can_have_enroller !== false,
        landing_route: body.landing_route?.trim() || null,
        is_system: body.is_system === true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Código de cargo já existe para este tenant', 400);
      throw new Error(error.message);
    }
    return successResponse(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao criar cargo';
    return errorResponse(message, 403);
  }
}
