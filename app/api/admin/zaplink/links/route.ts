/**
 * GET /api/admin/zaplink/links - Lista links
 * POST /api/admin/zaplink/links - Cria link
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req);

    const { data, error } = await supabaseServiceRole
      .from('zaplink_links')
      .select('id, slug, target_url, title, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao buscar links: ${error.message}`, 500);
    }

    return successResponse(data ?? []);
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const target_url = typeof body.target_url === 'string' ? body.target_url.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() || null : null;

    if (!slug || !target_url) {
      return errorResponse('Slug e target_url são obrigatórios', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('zaplink_links')
      .insert({ slug, target_url, title, updated_at: new Date().toISOString() })
      .select('id, slug, target_url, title, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Slug já existe', 400);
      return errorResponse(`Erro ao criar link: ${error.message}`, 500);
    }

    return successResponse(data, 'Link criado com sucesso');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
