/**
 * GET /api/zaplink/[slug]/resolve
 * Resolve link por slug, registra clique em zaplink_clicks, retorna target_url para redirect
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
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug: rawSlug } = await params;
    if (!rawSlug) {
      return errorResponse('Slug é obrigatório', 400);
    }
    const slug = decodeSlug(rawSlug);

    const { data: link, error: linkError } = await supabaseServiceRole
      .from('zaplink_links')
      .select('id, target_url')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (linkError || !link) {
      return errorResponse('Link não encontrado', 404);
    }

    const url = new URL(req.url);
    const utm_source = url.searchParams.get('utm_source') ?? null;
    const utm_medium = url.searchParams.get('utm_medium') ?? null;
    const utm_campaign = url.searchParams.get('utm_campaign') ?? null;
    const utm_term = url.searchParams.get('utm_term') ?? null;
    const utm_content = url.searchParams.get('utm_content') ?? null;
    const referer = req.headers.get('referer') ?? null;

    const metadata: Record<string, unknown> = {};
    url.searchParams.forEach((v, k) => {
      if (!k.startsWith('utm_')) metadata[k] = v;
    });

    await supabaseServiceRole
      .from('zaplink_clicks')
      .insert({
        zaplink_link_id: link.id,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        referer,
        metadata: Object.keys(metadata).length ? metadata : {},
      });

    return successResponse({ target_url: link.target_url });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
