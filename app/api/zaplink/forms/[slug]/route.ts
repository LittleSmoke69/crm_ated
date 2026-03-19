/**
 * GET /api/zaplink/forms/[slug]
 * Busca zaplink_forms por slug (público - para renderizar o formulário)
 */
import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

export const dynamic = 'force-dynamic';

function decodeSlug(raw: string): string {
  if (!raw) return '';
  let s = raw;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    }
  } catch {
    // mantém o original se der erro
  }
  return s.trim();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug: rawSlug } = await params;
    if (!rawSlug) {
      return errorResponse('Slug é obrigatório', 400);
    }
    const slug = decodeSlug(rawSlug);

    const { data: form, error } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id, slug, name, form_type')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      return errorResponse('Erro ao buscar formulário', 500);
    }
    if (!form) {
      return errorResponse('Formulário não encontrado', 404);
    }

    const formType = form.form_type === 'influenciador' ? 'influenciador' : 'consultor';
    return successResponse({ id: form.id, slug: form.slug, name: form.name, form_type: formType });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
