/**
 * POST /api/zaplink/forms/[slug]/submit
 * Insere submissão em zaplink_form_submissions (status=pending)
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
    // mantém o original
  }
  return s.trim();
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug: rawSlug } = await params;
    if (!rawSlug) {
      return errorResponse('Slug é obrigatório', 400);
    }
    const slug = decodeSlug(rawSlug);

    const body = await req.json().catch(() => ({}));
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : (typeof body.nome === 'string' ? body.nome.trim() : '');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : (typeof body.telefone === 'string' ? body.telefone.trim() : '');
    const instagramHandle = typeof body.instagram_handle === 'string' ? body.instagram_handle.trim().replace(/^@/, '') : null;

    if (!fullName || !email || !phone) {
      return errorResponse('Nome, e-mail e telefone são obrigatórios', 400);
    }

    const { data: form, error: formError } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id, form_type')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (formError || !form) {
      return errorResponse('Formulário não encontrado', 404);
    }

    const formType = form.form_type === 'influenciador' ? 'influenciador' : 'consultor';
    if (formType === 'influenciador' && (!instagramHandle || !instagramHandle.length)) {
      return errorResponse('Instagram (@) é obrigatório para cadastro de influenciador', 400);
    }

    const insertPayload: Record<string, unknown> = {
      zaplink_form_id: form.id,
      full_name: fullName,
      email,
      phone,
      status: 'pending',
    };
    if (formType === 'influenciador' && instagramHandle) {
      insertPayload.instagram_handle = instagramHandle.startsWith('@') ? instagramHandle : `@${instagramHandle}`;
    }

    const { error: insertError } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .insert(insertPayload);

    if (insertError) {
      return errorResponse(`Erro ao salvar cadastro: ${insertError.message}`, 500);
    }

    return successResponse({ submitted: true }, 'Cadastro realizado com sucesso');
  } catch (e) {
    return serverErrorResponse(e);
  }
}
