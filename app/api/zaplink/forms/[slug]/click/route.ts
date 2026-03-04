/**
 * POST /api/zaplink/forms/[slug]/click
 * Registra clique no link do formulário (acesso à página /zl/form/[slug]). Público.
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
    // ignore
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

    const { data: form, error: formError } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (formError || !form) {
      return errorResponse('Formulário não encontrado', 404);
    }

    const referer = req.headers.get('referer') ?? null;
    const body = await req.json().catch(() => ({}));
    const utm_source = typeof body.utm_source === 'string' ? body.utm_source : null;
    const utm_medium = typeof body.utm_medium === 'string' ? body.utm_medium : null;
    const utm_campaign = typeof body.utm_campaign === 'string' ? body.utm_campaign : null;
    const utm_content = typeof body.utm_content === 'string' ? body.utm_content : null;
    const utm_term = typeof body.utm_term === 'string' ? body.utm_term : null;

    const metadata: Record<string, unknown> = {};
    if (body && typeof body === 'object') {
      Object.entries(body).forEach(([k, v]) => {
        if (!k.startsWith('utm_') && k !== 'referer' && typeof v === 'string') metadata[k] = v;
      });
    }

    await supabaseServiceRole
      .from('zaplink_form_clicks')
      .insert({
        zaplink_form_id: form.id,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        referer,
        metadata: Object.keys(metadata).length ? metadata : {},
      });

    return successResponse({ ok: true });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
