/**
 * GET /api/admin/zaplink/forms - Lista formulários
 * POST /api/admin/zaplink/forms - Cria formulário
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req);

    const { data: forms, error } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id, slug, name, form_type, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao buscar formulários: ${error.message}`, 500);
    }

    const list = forms ?? [];
    if (list.length === 0) {
      return successResponse([]);
    }

    const formIds = list.map((f: { id: string }) => f.id);

    const [clicksRes, subsRes] = await Promise.all([
      supabaseServiceRole
        .from('zaplink_form_clicks')
        .select('zaplink_form_id')
        .in('zaplink_form_id', formIds),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('zaplink_form_id')
        .in('zaplink_form_id', formIds),
    ]);

    const clickCounts: Record<string, number> = {};
    const subCounts: Record<string, number> = {};
    formIds.forEach((id: string) => {
      clickCounts[id] = 0;
      subCounts[id] = 0;
    });
    (clicksRes.data ?? []).forEach((r: { zaplink_form_id: string }) => {
      clickCounts[r.zaplink_form_id] = (clickCounts[r.zaplink_form_id] ?? 0) + 1;
    });
    (subsRes.data ?? []).forEach((r: { zaplink_form_id: string }) => {
      subCounts[r.zaplink_form_id] = (subCounts[r.zaplink_form_id] ?? 0) + 1;
    });

    const data = list.map((f: { id: string } & Record<string, unknown>) => ({
      ...f,
      click_count: clickCounts[f.id] ?? 0,
      submission_count: subCounts[f.id] ?? 0,
    }));

    return successResponse(data);
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const formType = body.form_type === 'influenciador' ? 'influenciador' : 'consultor';

    if (!slug || !name) {
      return errorResponse('Slug e name são obrigatórios', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('zaplink_forms')
      .insert({ slug, name, form_type: formType, updated_at: new Date().toISOString() })
      .select('id, slug, name, form_type, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Slug já existe', 400);
      return errorResponse(`Erro ao criar formulário: ${error.message}`, 500);
    }

    return successResponse(data, 'Formulário criado com sucesso');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
